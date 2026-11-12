import { afterAll, describe, expect, it } from "vitest";
import { game } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { required } from "./rows";
import { seasonStandings } from "./standings";

afterAll(closePool);

describe("seasonStandings", () => {
  it("counts final scores and forfeits, and nothing else", async () => {
    await inRolledBackDb(async (db) => {
      const tag = Math.random().toString(36).slice(2, 8);
      const lg = required(
        (
          await db
            .insert(league)
            .values({ name: "Test League", slug: `std-${tag}` })
            .returning({ id: league.id })
        )[0],
        "league",
      );
      const sn = required(
        (
          await db
            .insert(season)
            .values({
              leagueId: lg.id,
              name: "Fall",
              slug: "fall",
              status: "in_progress",
              startsOn: "2026-09-01",
              endsOn: "2026-11-01",
              feeModel: "per_player",
              playerFeeCents: 8500,
              rosterMin: 12,
              rosterMax: 20,
            })
            .returning({ id: season.id })
        )[0],
        "season",
      );
      const teams = await db
        .insert(team)
        .values(
          ["Aces", "Bees", "Cats"].map((name) => ({
            leagueId: lg.id,
            name,
            slug: name.toLowerCase(),
          })),
        )
        .returning({ id: team.id });
      const entries = await db
        .insert(teamSeason)
        .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
        .returning({ id: teamSeason.id });
      const [a, b, c] = entries.map((e) => e.id);
      if (!a || !b || !c) throw new Error("teams missing");
      const done = new Date("2026-09-10T02:00:00Z");
      await db.insert(game).values([
        {
          seasonId: sn.id,
          teamAId: a,
          teamBId: b,
          status: "final",
          scoreA: 6,
          scoreB: 2,
          finalizedAt: done,
        },
        {
          seasonId: sn.id,
          teamAId: b,
          teamBId: c,
          status: "forfeit",
          forfeitBy: c,
          finalizedAt: done,
        },
        // Not counted: still to play, and a playoff game.
        { seasonId: sn.id, teamAId: a, teamBId: c, status: "scheduled" },
        {
          seasonId: sn.id,
          teamAId: a,
          teamBId: c,
          kind: "playoff",
          status: "final",
          scoreA: 1,
          scoreB: 9,
          finalizedAt: done,
        },
      ]);
      const { rows, teams: names } = await seasonStandings(db, sn.id);
      expect(
        rows.map((r) => [
          names.get(r.teamId)?.name,
          r.wins,
          r.losses,
          r.runsFor,
        ]),
      ).toEqual([
        ["Aces", 1, 0, 6],
        ["Bees", 1, 1, 2],
        ["Cats", 0, 1, 0],
      ]);
    });
  });
});
