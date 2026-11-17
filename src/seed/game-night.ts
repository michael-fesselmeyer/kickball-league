import type { Db } from "@/db/queries/schedule";
import { gameRsvp, scoreReport, scoreResponse } from "@/db/schema";
import type { ScoreReportId, UserId } from "@/domain/ids";
import { seededRandom } from "@/domain/random";
import { RULEBOOK } from "@/domain/rsvp/fielding";
import { demoPersonaRows } from "./demo-personas";
import { PLAYED_ROUNDS, type SeedData } from "./generate";

/**
 * What a healthy league looks like on and around game night, for the demo:
 * - RSVPs for every game of the round being played and the next one: most
 *   of each team in, and one to three out or not answered yet, while the
 *   rest still field a full side of eleven (rulebook 2.3), so no game reads
 *   as short or a forfeit risk. Answers the kicking-order demo already gave
 *   stay.
 * - A confirmed score for every final game: the first team's captain
 *   reported it half an hour after the game, and the other captain
 *   confirmed it, so a captain's past game shows its score, not a form.
 * Pure rows plus one insert function, with fixed ids, so a reseed gives
 * the same answers.
 */

/** A full side on defense, at most six of either fielding group. */
const FULL_SIDE = RULEBOOK.maxFielders;
const fielders = (bySide: ReadonlyMap<string, number>) =>
  Math.min(
    FULL_SIDE,
    [...bySide.values()].reduce(
      (sum, n) => sum + Math.min(n, RULEBOOK.maxPerGender),
      0,
    ),
  );

const reportId = (n: number) =>
  `5c0e0000-0000-4000-8000-${String(n).padStart(12, "0")}` as ScoreReportId;

/** Each fall team's players with their fielding group, and its captain. */
function rosters(data: SeedData) {
  const personas = demoPersonaRows(data);
  const regs = new Map(
    [...data.registrations, ...personas.registrations].map((r) => [r.id, r]),
  );
  const side = new Map(
    [...data.profiles, ...personas.profiles].map((p) => [
      p.userId,
      p.lineupGender,
    ]),
  );
  const handedOff = personas.handOffMembershipId;
  const members = [
    ...data.rosterMemberships.map((m) =>
      m.id === handedOff ? { ...m, role: "co_captain" as const } : m,
    ),
    ...personas.rosterMemberships,
  ];
  return new Map(
    data.teamSeasons.map((t) => {
      const own = members.filter((m) => m.teamSeasonId === t.id);
      const players = own.flatMap((m) => {
        const userId = regs.get(m.registrationId)?.userId;
        return userId
          ? [{ userId, side: side.get(userId) ?? "woman", role: m.role }]
          : [];
      });
      const captain = players.find((p) => p.role === "captain")?.userId;
      if (!captain) throw new Error("A seed team has no captain");
      return [t.id, { players, captain }] as const;
    }),
  );
}

export function gameNightRows(data: SeedData) {
  const random = seededRandom(5150);
  const teams = rosters(data);
  const coming = data.games.filter(
    (g) => g.roundNo === PLAYED_ROUNDS + 1 || g.roundNo === PLAYED_ROUNDS + 2,
  );

  const rsvps = coming.flatMap((g) =>
    [g.teamAId, g.teamBId].flatMap((teamSeasonId) => {
      const team = teams.get(teamSeasonId);
      if (!team) return [];
      const inBySide = new Map<string, number>();
      for (const p of team.players)
        inBySide.set(p.side, (inBySide.get(p.side) ?? 0) + 1);
      // One to three away (out, or not answered yet), never the captain,
      // and only while the rest still field a full side.
      const away = new Map<UserId, "out" | "silent">();
      const wanted = random.int(1, 3);
      for (const p of random.shuffle(team.players)) {
        if (away.size >= wanted) break;
        if (p.role === "captain") continue;
        const after = new Map(inBySide);
        after.set(p.side, (after.get(p.side) ?? 0) - 1);
        if (fielders(after) < FULL_SIDE) continue;
        inBySide.set(p.side, after.get(p.side) ?? 0);
        away.set(p.userId, away.size % 2 === 0 ? "out" : "silent");
      }
      return team.players.flatMap((p) => {
        const said = away.get(p.userId);
        if (said === "silent") return [];
        return [
          {
            gameId: g.id,
            userId: p.userId,
            teamSeasonId,
            status: said === "out" ? ("out" as const) : ("in" as const),
          },
        ];
      });
    }),
  );

  const finals = data.games.filter((g) => g.status === "final");
  const reports = finals.map((g, i) => {
    const reporter = teams.get(g.teamAId)?.captain;
    if (!reporter || g.scoreA === null || g.scoreB === null || !g.finalizedAt)
      throw new Error("A final seed game has no captain or score");
    return {
      id: reportId(i + 1),
      gameId: g.id,
      reportedBy: reporter,
      reporterRole: "captain" as const,
      teamSeasonId: g.teamAId,
      scoreA: g.scoreA,
      scoreB: g.scoreB,
      inningsPlayed: g.inningsPlayed,
      clientId: `seed-score-${g.id}`,
      reportedAt: new Date(g.finalizedAt.getTime() - 25 * 60_000),
    };
  });
  const responses = finals.flatMap((g, i) => {
    const confirmer = teams.get(g.teamBId)?.captain;
    return confirmer && g.finalizedAt
      ? [
          {
            scoreReportId: reportId(i + 1),
            teamSeasonId: g.teamBId,
            userId: confirmer,
            status: "confirmed" as const,
            respondedAt: g.finalizedAt,
          },
        ]
      : [];
  });
  return { rsvps, reports, responses };
}

/** Adds the game-night RSVPs and confirmed scores, after the kicking orders. */
export async function addGameNight(db: Db, data: SeedData): Promise<void> {
  const rows = gameNightRows(data);
  for (let i = 0; i < rows.rsvps.length; i += 500)
    await db
      .insert(gameRsvp)
      .values(rows.rsvps.slice(i, i + 500))
      .onConflictDoNothing();
  if (rows.reports.length > 0) {
    await db.insert(scoreReport).values(rows.reports);
    await db.insert(scoreResponse).values(rows.responses);
  }
}
