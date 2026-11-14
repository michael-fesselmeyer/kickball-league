import { afterAll, describe, expect, it } from "vitest";
import type { LeagueId, SeasonId, TeamId, TeamSeasonId } from "@/domain/ids";
import { game } from "../schema/game";
import { league } from "../schema/league";
import { bracket } from "../schema/playoffs";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { leagueHistory, teamHistory } from "./history";
import type { Db } from "./schedule";
import { required } from "./rows";

afterAll(closePool);

const DONE = new Date("2026-05-01T02:00:00Z");

/**
 * A league with a completed spring, a fall being played and a draft winter:
 * Aces win spring; Bees lead fall; Dots withdrew from fall.
 */
async function history(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "History League", slug: `hist-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  const addSeason = async (
    name: string,
    status: "completed" | "in_progress" | "draft",
    startsOn: string,
  ) =>
    required(
      (
        await db
          .insert(season)
          .values({
            leagueId: lg.id,
            name,
            slug: name.toLowerCase(),
            status,
            startsOn,
            endsOn: startsOn,
            feeModel: "per_player",
            playerFeeCents: 8500,
            rosterMin: 12,
            rosterMax: 20,
          })
          .returning({ id: season.id })
      )[0],
      "season",
    ).id;
  const spring = await addSeason("Spring", "completed", "2026-04-06");
  const fall = await addSeason("Fall", "in_progress", "2026-09-15");
  const winter = await addSeason("Winter", "draft", "2027-01-10");
  const teams = new Map(
    (
      await db
        .insert(team)
        .values(
          ["Aces", "Bees", "Cats", "Dots"].map((name) => ({
            leagueId: lg.id,
            name,
            slug: name.toLowerCase(),
          })),
        )
        .returning({ id: team.id, slug: team.slug })
    ).map((t) => [t.slug, t.id]),
  );
  const enter = async (
    seasonId: SeasonId,
    slugs: string[],
    withdrawn: string[] = [],
  ) => {
    const entries = new Map<string, TeamSeasonId>();
    for (const slug of slugs) {
      const [row] = await db
        .insert(teamSeason)
        .values({
          teamId: teams.get(slug) as TeamId,
          seasonId,
          status: withdrawn.includes(slug) ? "withdrawn" : "confirmed",
        })
        .returning({ id: teamSeason.id });
      entries.set(slug, required(row, "entry").id);
    }
    return entries;
  };
  const s = await enter(spring, ["aces", "bees", "cats"]);
  const f = await enter(fall, ["aces", "bees", "dots"], ["dots"]);
  const w = await enter(winter, ["aces", "bees"]);
  const final = (
    seasonId: SeasonId,
    a: TeamSeasonId,
    scoreA: number,
    b: TeamSeasonId,
    scoreB: number,
  ) => ({
    seasonId,
    teamAId: a,
    teamBId: b,
    status: "final" as const,
    scoreA,
    scoreB,
    finalizedAt: DONE,
  });
  const e = (m: Map<string, TeamSeasonId>, slug: string) =>
    m.get(slug) as TeamSeasonId;
  await db.insert(game).values([
    final(spring, e(s, "aces"), 8, e(s, "bees"), 3),
    final(spring, e(s, "aces"), 5, e(s, "cats"), 5),
    final(spring, e(s, "bees"), 20, e(s, "cats"), 1),
    // Not in the records: a playoff game and one still to play.
    {
      ...final(spring, e(s, "cats"), 9, e(s, "aces"), 0),
      kind: "playoff" as const,
    },
    { seasonId: spring, teamAId: e(s, "aces"), teamBId: e(s, "bees") },
    final(fall, e(f, "bees"), 6, e(f, "aces"), 4),
    // The withdrawn entry's game: it counts for Aces, Dots are hidden.
    final(fall, e(f, "aces"), 7, e(f, "dots"), 2),
    // A draft season is not public.
    final(winter, e(w, "aces"), 30, e(w, "bees"), 0),
  ]);
  return { leagueId: lg.id, spring, springEntries: s, teams };
}

describe("leagueHistory", () => {
  it("lists completed seasons with the champion and final standings", async () => {
    await inRolledBackDb(async (db) => {
      const { leagueId, spring } = await history(db);
      const { pastSeasons } = await leagueHistory(db, leagueId);
      expect(pastSeasons.map((s) => [s.id, s.name])).toEqual([
        [spring, "Spring"],
      ]);
      const [past] = pastSeasons;
      expect(past?.champion?.name).toBe("Aces");
      expect(
        past?.standings.map((r) => [
          r.team?.name,
          r.rank,
          r.wins,
          r.losses,
          r.ties,
        ]),
      ).toEqual([
        ["Aces", 1, 1, 0, 1],
        ["Bees", 2, 1, 1, 0],
        ["Cats", 3, 0, 1, 1],
      ]);
    });
  });

  it("adds up the all-time table over every public season", async () => {
    await inRolledBackDb(async (db) => {
      const { leagueId } = await history(db);
      const { allTime } = await leagueHistory(db, leagueId);
      expect(
        allTime.map((r) => [
          r.info?.name,
          r.seasons,
          r.wins,
          r.losses,
          r.ties,
          r.runDifference,
          r.titles,
        ]),
      ).toEqual([
        // Aces: +5, 0, -2, +5 run difference; the spring title.
        ["Aces", 2, 2, 1, 1, 8, 1],
        // Bees: -5, +10 (capped from +19), +2.
        ["Bees", 2, 2, 1, 0, 7, 0],
        ["Cats", 1, 0, 1, 1, -10, 0],
      ]);
    });
  });

  it("is empty for a league without seasons", async () => {
    await inRolledBackDb(async (db) => {
      const [lg] = await db
        .insert(league)
        .values({ name: "New League", slug: "new-league-history" })
        .returning({ id: league.id });
      expect(await leagueHistory(db, (lg as { id: LeagueId }).id)).toEqual({
        pastSeasons: [],
        allTime: [],
        seasonIds: [],
      });
    });
  });
});

describe("a season with a playoff bracket", () => {
  it("crowns the bracket's champion over the top of the standings", async () => {
    await inRolledBackDb(async (db) => {
      const { leagueId, spring, springEntries, teams } = await history(db);
      const cats = springEntries.get("cats") as TeamSeasonId;
      await db.insert(bracket).values({
        seasonId: spring,
        status: "complete",
        size: 2,
        seeds: [
          { seed: 1, teamSeasonId: springEntries.get("aces") as string },
          { seed: 2, teamSeasonId: cats },
        ],
        championId: cats,
      });
      const { pastSeasons, allTime } = await leagueHistory(db, leagueId);
      expect(pastSeasons[0]?.champion?.name).toBe("Cats");
      expect(allTime.find((r) => r.team === "cats")?.titles).toBe(1);
      expect(allTime.find((r) => r.team === "aces")?.titles).toBe(0);
      const won = await teamHistory(db, teams.get("cats") as TeamId, "cats");
      expect(won.titles).toEqual([{ name: "Spring", slug: "spring" }]);
    });
  });

  it("ignores a bracket that is not finished", async () => {
    await inRolledBackDb(async (db) => {
      const { leagueId, spring, springEntries } = await history(db);
      await db.insert(bracket).values({
        seasonId: spring,
        status: "published",
        size: 2,
        seeds: [
          { seed: 1, teamSeasonId: springEntries.get("aces") as string },
          { seed: 2, teamSeasonId: springEntries.get("cats") as string },
        ],
      });
      const { pastSeasons } = await leagueHistory(db, leagueId);
      expect(pastSeasons[0]?.champion?.name).toBe("Aces");
    });
  });
});

describe("teamHistory", () => {
  it("gives a team's all-time record and the seasons it won", async () => {
    await inRolledBackDb(async (db) => {
      const { teams } = await history(db);
      const aces = await teamHistory(db, teams.get("aces") as TeamId, "aces");
      expect(aces.record).toMatchObject({
        seasons: 2,
        played: 4,
        wins: 2,
        losses: 1,
        ties: 1,
        runsFor: 24,
        runsAgainst: 16,
        runDifference: 8,
        titles: 1,
      });
      expect(aces.titles).toEqual([{ name: "Spring", slug: "spring" }]);
    });
  });

  it("counts nothing for a team whose only entry was withdrawn", async () => {
    await inRolledBackDb(async (db) => {
      const { teams } = await history(db);
      const dots = await teamHistory(db, teams.get("dots") as TeamId, "dots");
      expect(dots.record).toMatchObject({ seasons: 0, played: 0, titles: 0 });
      expect(dots.titles).toEqual([]);
    });
  });
});
