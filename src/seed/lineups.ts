import type { Db } from "@/db/queries/schedule";
import {
  gameLineup,
  gameLineupSpot,
  gameRsvp,
  refereeAssignment,
} from "@/db/schema";
import type { GameLineupId, RefereeAssignmentId } from "@/domain/ids";
import { runBreaks } from "@/domain/lineup/order";
import { demoPersonaRows } from "./demo-personas";
import { PLAYED_ROUNDS, type SeedData } from "./generate";

/**
 * Kicking orders for the demo captain's team (src/seed/demo-personas.ts),
 * for its two games after the ones Reese Ref already has:
 * - Five women and five men, the demo player and captain among them, said
 *   they're in for both.
 * - The earlier game has an order that keeps to the two-in-a-row rule, for
 *   "Copy last game".
 * - The later game has an order with three women in a row, so a demo
 *   visitor sees a rule break and auto-arrange fixing it. Reese Ref
 *   referees it, so they can see the order on game day.
 */
const rowId = <T extends string>(n: number) =>
  `b1e50000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export function seedLineupRows(data: SeedData) {
  const personas = demoPersonaRows(data);
  const team = data.teamSeasons[0];
  if (!team) throw new Error("The seed has no teams");
  const [earlier, later] = data.games
    .filter(
      (g) =>
        (g.teamAId === team.id || g.teamBId === team.id) &&
        g.roundNo > PLAYED_ROUNDS + 1,
    )
    .sort((a, b) => a.roundNo - b.roundNo);
  if (!earlier || !later) throw new Error("The first team has too few games");
  const captainId = personas.registrations[0]?.userId;
  const refId = personas.refereeAssignments[0]?.userId;
  if (!captainId || !refId) throw new Error("The seed has no demo personas");

  const profiles = [...personas.profiles, ...data.profiles];
  const members = [...personas.registrations, ...data.registrations]
    .filter((r) =>
      [...personas.rosterMemberships, ...data.rosterMemberships].some(
        (m) => m.registrationId === r.id && m.teamSeasonId === team.id,
      ),
    )
    .flatMap((r) => {
      const p = profiles.find((x) => x.userId === r.userId);
      return p ? [{ userId: r.userId, side: p.lineupGender }] : [];
    });
  const women = members.filter((m) => m.side === "woman").slice(0, 5);
  const men = members.filter((m) => m.side === "man").slice(0, 5);
  if (women.length < 5 || men.length < 5)
    throw new Error("The first team needs five women and five men");
  const coming = [...women, ...men];

  const rsvps = [earlier, later].flatMap((g, i) =>
    coming.map((m) => ({
      gameId: g.id,
      userId: m.userId,
      teamSeasonId: team.id,
      status: "in" as const,
      updatedAt: new Date(`2026-10-1${i + 2}T16:00:00Z`),
    })),
  );
  // Alternating keeps to the rule; three women first breaks it.
  const alternating = women.flatMap((w, i) => [w, men[i] ?? w]);
  const [w0, w1, w2, w3, w4] = women;
  const [m0, m1, m2, m3, m4] = men;
  const broken = [w0, w1, w2, m0, m1, w3, m2, w4, m3, m4].flatMap((m) =>
    m ? [m] : [],
  );
  const lineups = [
    { n: 1, game: earlier, order: alternating },
    { n: 2, game: later, order: broken },
  ];
  return {
    rsvps,
    lineups: lineups.map(({ n, game, order }) => ({
      id: rowId<GameLineupId>(n),
      gameId: game.id,
      teamSeasonId: team.id,
      runBreaks: runBreaks(order.map((m) => ({ side: m.side }))).length,
      createdBy: captainId,
      updatedBy: captainId,
    })),
    spots: lineups.flatMap(({ n, order }) =>
      order.map((m, i) => ({
        lineupId: rowId<GameLineupId>(n),
        position: i + 1,
        userId: m.userId,
      })),
    ),
    refereeAssignment: {
      id: rowId<RefereeAssignmentId>(3),
      gameId: later.id,
      userId: refId,
      status: "accepted" as const,
      respondedAt: new Date("2026-08-25T16:00:00Z"),
    },
  };
}

/** Adds the demo kicking orders, after the personas. */
export async function addSeedLineups(db: Db, data: SeedData): Promise<void> {
  const rows = seedLineupRows(data);
  await db.insert(gameRsvp).values(rows.rsvps);
  await db.insert(gameLineup).values(rows.lineups);
  await db.insert(gameLineupSpot).values(rows.spots);
  await db.insert(refereeAssignment).values(rows.refereeAssignment);
}
