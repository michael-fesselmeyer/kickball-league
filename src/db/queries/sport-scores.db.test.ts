import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { TeamSeasonId } from "@/domain/ids";
import type { ScoreInput } from "@/domain/scores/scores";
import { user } from "../schema/auth";
import { division, ruleSet } from "../schema/division";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { required } from "./rows";
import type { Db } from "./schedule";
import { gameForScoring, reportScore } from "./scores";
import { seasonDivisionStandings } from "./standings";

afterAll(closePool);

/**
 * Scores by the league's sport (ADR 0072): a dodgeball league reports sets,
 * its match length comes from its rule sets, and its standings read sets.
 */

const KICKOFF = new Date("2026-12-03T00:00:00Z");
const after = (hours: number) =>
  new Date(KICKOFF.getTime() + hours * 3_600_000);

const one = <T>(rows: T[], what: string): T => required(rows[0], what);

async function world(
  db: Db,
  {
    sport = "dodgeball",
    leagueBestOf = null,
    divisionBestOf,
  }: {
    sport?: string;
    leagueBestOf?: number | null;
    /** A division with its own rule set; undefined for no division. */
    divisionBestOf?: number | null;
  } = {},
) {
  const tag = Math.random().toString(36).slice(2, 8);
  const admin = one(
    await db
      .insert(user)
      .values({ name: "admin", email: `sport-${tag}@example.test` })
      .returning({ id: user.id }),
    "user",
  ).id;
  const lg = one(
    await db
      .insert(league)
      .values({ name: "Gym Night", slug: `sport-${tag}`, sport })
      .returning({ id: league.id }),
    "league",
  );
  // The rule set made with the league, the league's first.
  await db
    .insert(ruleSet)
    .values({ leagueId: lg.id, name: "Standard", bestOf: leagueBestOf });
  const sn = one(
    await db
      .insert(season)
      .values({
        leagueId: lg.id,
        name: "Winter",
        slug: "winter",
        status: "in_progress",
        startsOn: "2026-12-01",
        endsOn: "2027-02-28",
        feeModel: "per_team",
        teamFeeCents: 50000,
        rosterMin: 8,
        rosterMax: 14,
      })
      .returning({ id: season.id }),
    "season",
  );
  let divisionId = null;
  if (divisionBestOf !== undefined) {
    const rs = one(
      await db
        .insert(ruleSet)
        .values({
          leagueId: lg.id,
          name: "Competitive",
          bestOf: divisionBestOf,
        })
        .returning({ id: ruleSet.id }),
      "rule set",
    );
    divisionId = one(
      await db
        .insert(division)
        .values({
          seasonId: sn.id,
          name: "Competitive",
          slug: "competitive",
          ruleSetId: rs.id,
        })
        .returning({ id: division.id }),
      "division",
    ).id;
  }
  const vn = one(
    await db
      .insert(venue)
      .values({ leagueId: lg.id, name: "Gym", slug: "gym" })
      .returning({ id: venue.id }),
    "venue",
  );
  const court = one(
    await db
      .insert(field)
      .values({ venueId: vn.id, name: "Court 1" })
      .returning({ id: field.id }),
    "court",
  );
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees", "Cats"].map((name) => ({
        leagueId: lg.id,
        name,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const entries = await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id, divisionId })))
    .returning({ id: teamSeason.id });
  const [a, b, c] = entries.map((e) => e.id) as [
    TeamSeasonId,
    TeamSeasonId,
    TeamSeasonId,
  ];
  const newGame = async (
    teamAId: TeamSeasonId,
    teamBId: TeamSeasonId,
    i: number,
    kind: "regular" | "playoff" = "regular",
  ) => {
    const sl = one(
      await db
        .insert(slot)
        .values({
          seasonId: sn.id,
          fieldId: court.id,
          startsAt: after(i),
          endsAt: after(i + 1),
          timeIndex: i,
        })
        .returning({ id: slot.id }),
      "slot",
    );
    return one(
      await db
        .insert(game)
        .values({ seasonId: sn.id, teamAId, teamBId, slotId: sl.id, kind })
        .returning({ id: game.id }),
      "game",
    ).id;
  };
  return { admin, a, b, c, seasonId: sn.id, newGame, tag };
}

const sets = (
  scoreA: number,
  scoreB: number,
  outcome: ScoreInput["outcome"] = "normal",
  inningsPlayed: number | null = null,
): ScoreInput => ({ outcome, scoreA, scoreB, inningsPlayed });

describe("scores by sport", () => {
  it("reads the match length from the division, then the league, then the sport", async () => {
    await inRolledBackDb(async (db) => {
      const fallback = await world(db);
      const g1 = await fallback.newGame(fallback.a, fallback.b, 0);
      expect(await gameForScoring(db, g1)).toMatchObject({
        sport: "dodgeball",
        bestOf: null,
      });

      const leagueWide = await world(db, { leagueBestOf: 3 });
      const g2 = await leagueWide.newGame(leagueWide.a, leagueWide.b, 0);
      expect((await gameForScoring(db, g2))?.bestOf).toBe(3);

      const divided = await world(db, { leagueBestOf: 3, divisionBestOf: 7 });
      const g3 = await divided.newGame(divided.a, divided.b, 0);
      expect((await gameForScoring(db, g3))?.bestOf).toBe(7);

      // A division whose rule set leaves it empty falls back to the league's.
      const unset = await world(db, { leagueBestOf: 3, divisionBestOf: null });
      const g4 = await unset.newGame(unset.a, unset.b, 0);
      expect((await gameForScoring(db, g4))?.bestOf).toBe(3);
    });
  });

  it("takes sets by the match length and drops innings for a sport without them", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, { leagueBestOf: 3 });
      const gameId = await w.newGame(w.a, w.b, 0);
      const report = (score: ScoreInput, n: number) =>
        reportScore(db, {
          gameId,
          userId: w.admin,
          role: "admin",
          teamSeasonId: null,
          score,
          clientId: `s${n}-${w.tag}`,
          now: after(2),
        });
      // Best of 3: two sets win; three is more than the match holds.
      expect(await report(sets(3, 1), 1)).toMatchObject({
        ok: false,
        error: { scoreA: "Enter sets from 0 to 2." },
      });
      expect(await report(sets(1, 1), 2)).toMatchObject({
        ok: false,
        error: { scoreB: expect.stringMatching(/one winner of 2 sets/) },
      });
      expect(await report(sets(1, 0, "called", 6), 3)).toMatchObject({
        ok: true,
      });
      const [row] = await db
        .select({
          status: game.status,
          scoreA: game.scoreA,
          scoreB: game.scoreB,
          inningsPlayed: game.inningsPlayed,
        })
        .from(game)
        .where(eq(game.id, gameId));
      expect(row).toEqual({
        status: "final",
        scoreA: 1,
        scoreB: 0,
        inningsPlayed: null,
      });
    });
  });

  it("refuses a level called match in the playoffs", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const gameId = await w.newGame(w.a, w.b, 0, "playoff");
      expect(
        await reportScore(db, {
          gameId,
          userId: w.admin,
          role: "admin",
          teamSeasonId: null,
          score: sets(1, 1, "called"),
          clientId: `p-${w.tag}`,
          now: after(2),
        }),
      ).toMatchObject({ ok: false, error: { scoreB: expect.any(String) } });
    });
  });

  it("ranks a dodgeball season on sets, with the league's sport", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const results: [TeamSeasonId, TeamSeasonId, ScoreInput][] = [
        [w.a, w.b, sets(3, 0)],
        [w.b, w.c, sets(3, 2)],
        [w.c, w.a, sets(2, 1, "called")],
      ];
      for (const [i, [x, y, score]] of results.entries()) {
        const gameId = await w.newGame(x, y, i);
        await reportScore(db, {
          gameId,
          userId: w.admin,
          role: "admin",
          teamSeasonId: null,
          score,
          clientId: `r${i}-${w.tag}`,
          now: after(10),
        });
      }
      const { tables, sport } = await seasonDivisionStandings(db, w.seasonId);
      expect(sport).toBe("dodgeball");
      const rows = tables[0]?.rows ?? [];
      const byTeam = new Map(rows.map((r) => [r.teamId, r]));
      // One win each: the set difference decides it (A +2, C 0, B -2).
      expect(rows.map((r) => r.teamId)).toEqual([w.a, w.c, w.b]);
      expect(byTeam.get(w.a)).toMatchObject({
        wins: 1,
        losses: 1,
        runsFor: 4,
        runsAgainst: 2,
        runDifference: 2,
      });
      expect(rows[1]?.separatedBy).toBe("run_difference");
    });
  });

  it("leaves a kickball league's scores as they were", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, { sport: "kickball" });
      const gameId = await w.newGame(w.a, w.b, 0);
      expect(
        await reportScore(db, {
          gameId,
          userId: w.admin,
          role: "admin",
          teamSeasonId: null,
          score: sets(12, 4, "called", 5),
          clientId: `k-${w.tag}`,
          now: after(2),
        }),
      ).toMatchObject({ ok: true });
      const [row] = await db
        .select({ inningsPlayed: game.inningsPlayed })
        .from(game)
        .where(eq(game.id, gameId));
      expect(row?.inningsPlayed).toBe(5);
    });
  });
});
