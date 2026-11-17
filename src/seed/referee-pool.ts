import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import {
  refereeAssignment,
  refereePayout,
  refereePayRate,
  refereeProfile,
} from "@/db/schema";
import { user } from "@/db/schema/auth";
import type { RefereeAssignmentId, SeasonId, UserId } from "@/domain/ids";
import { PERSONAS } from "@/lib/demo/personas";
import { demoPersonaRows } from "./demo-personas";
import { PLAYED_ROUNDS, SEED_EMAIL_DOMAIN, type SeedData } from "./generate";
import { seedLineupRows } from "./lineups";
import { insertSeedProfiles } from "./roles";

/** The fall season's per-game ref fee, in cents. */
export const SEED_REF_FEE_CENTS = 2500;

/** The league's other two refs: invented people on the seed's own domain. */
export const POOL_REFS = [
  { first: "Rory", last: "Calloway" },
  { first: "Jo", last: "Whitlock" },
] as const;

const poolId = <T extends string>(n: number) =>
  `7e750000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

/**
 * The ref pool and pay sheet for the demo (ADR 0053): Reese Ref and two
 * other refs make up the league's pool, the fall season pays $25 a game,
 * and Reese checked in for the games of the last played round, so the pay
 * sheet has something owed. Reese says nothing about times yet; the
 * "assign then pay" flow ticks them on the ref's own page.
 *
 * From the last played round on, every game has one ref and no ref has two
 * games at the same kickoff: Reese's (src/seed/demo-personas.ts and the
 * kicking-order demo, src/seed/lineups.ts), and the other two take the rest
 * of each kickoff in turn.
 */
export function seedRefereePoolRows(data: SeedData) {
  const rows = demoPersonaRows(data);
  const ref = rows.users.find((u) => u.email === PERSONAS.ref.email);
  if (!ref) throw new Error("The seed has no demo ref");
  const played = new Set(
    data.games.filter((g) => g.roundNo === PLAYED_ROUNDS).map((g) => g.id),
  );
  const checkedIn = rows.refereeAssignments
    .filter((a) => played.has(a.gameId))
    .map((a) => a.id);

  const pool = POOL_REFS.map((p, i) => ({
    id: poolId<UserId>(i + 1),
    name: `${p.first} ${p.last}`,
    email: `${p.first}.${p.last}.ref@${SEED_EMAIL_DOMAIN}`.toLowerCase(),
    emailVerified: true,
  }));
  const profiles = POOL_REFS.map((p, i) => ({
    userId: poolId<UserId>(i + 1),
    firstName: p.first,
    lastName: p.last,
    gender: i === 0 ? ("man" as const) : ("woman" as const),
    lineupGender: i === 0 ? ("man" as const) : ("woman" as const),
    shirtSize: "l" as const,
    globalRole: "player" as const,
  }));

  const reeses = new Set([
    ...rows.refereeAssignments.map((a) => a.gameId),
    seedLineupRows(data).refereeAssignment.gameId,
  ]);
  const startOf = new Map(data.slots.map((s) => [s.id, s.startsAt.getTime()]));
  const open = data.games
    .filter((g) => g.roundNo >= PLAYED_ROUNDS && !reeses.has(g.id))
    .sort(
      (a, b) =>
        (startOf.get(a.slotId) ?? 0) - (startOf.get(b.slotId) ?? 0) ||
        a.id.localeCompare(b.id),
    );
  const kickoffs = Map.groupBy(open, (g) => startOf.get(g.slotId) ?? 0);
  let n = 0;
  const assignments = [...kickoffs.values()].flatMap((games) => {
    if (games.length > pool.length)
      throw new Error("More games at one kickoff than the pool has refs");
    return games.map((g, i) => ({
      id: poolId<RefereeAssignmentId>(101 + n++),
      gameId: g.id,
      userId: pool[i]?.id as UserId,
      status: "accepted" as const,
      respondedAt: new Date("2026-08-25T16:00:00Z"),
      // They were at the field for the games already played.
      checkedInAt: played.has(g.id) ? new Date("2026-10-06T23:40:00Z") : null,
    }));
  });

  return {
    profiles: [ref.id, ...pool.map((p) => p.id)].map((userId) => ({
      leagueId: data.league.id,
      userId,
    })),
    poolUsers: pool,
    poolProfiles: profiles,
    assignments,
    rate: { seasonId: data.season.id, feeCents: SEED_REF_FEE_CENTS },
    checkedIn,
    checkedInAt: new Date("2026-10-06T23:40:00Z"),
  };
}

export async function addSeedRefereePool(
  db: Db,
  data: SeedData,
): Promise<void> {
  const rows = seedRefereePoolRows(data);
  await db.insert(user).values(rows.poolUsers);
  await insertSeedProfiles(db, data.league.id, rows.poolProfiles);
  await db.insert(refereeProfile).values(rows.profiles);
  if (rows.assignments.length > 0)
    await db.insert(refereeAssignment).values(rows.assignments);
  await db.insert(refereePayRate).values(rows.rate);
  if (rows.checkedIn.length > 0)
    await db
      .update(refereeAssignment)
      .set({ checkedInAt: rows.checkedInAt })
      .where(
        and(
          inArray(refereeAssignment.id, rows.checkedIn),
          eq(refereeAssignment.status, "accepted"),
        ),
      );
}

/**
 * Payouts recorded in an earlier run hold on to their season and ref, so
 * they go before the seed replaces the league. Their books expenses go
 * with the books.
 */
export async function removeSeedRefereePayouts(
  db: Db,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  if (seasonIds.length > 0)
    await db
      .delete(refereePayout)
      .where(inArray(refereePayout.seasonId, [...seasonIds]));
}
