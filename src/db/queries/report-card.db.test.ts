import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SeasonId, TeamSeasonId } from "@/domain/ids";
import { sportsmanshipRating } from "../schema/discipline";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { seasonSurvey, surveyAnswer } from "../schema/survey";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { reportExtras } from "./report-card";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

/**
 * Two seasons of one league. Fall has a survey with three answers, three
 * sportsmanship ratings, two games played (one forfeit), one still to play,
 * and two rained-out slots: one in a published schedule, one only in a
 * draft that never went out. Spring has nothing yet.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "Test League", slug: `rc-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  const seasons = await db
    .insert(season)
    .values(
      (
        [
          ["fall", "2026-09-01", "completed"],
          ["spring", "2027-04-01", "in_progress"],
        ] as const
      ).map(([slug, startsOn, status]) => ({
        leagueId: lg.id,
        name: slug,
        slug: `${slug}-${tag}`,
        startsOn,
        endsOn: startsOn,
        status,
        feeModel: "per_player" as const,
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      })),
    )
    .returning({ id: season.id });
  const [fall, spring] = seasons.map((s) => s.id) as [SeasonId, SeasonId];
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees"].map((name) => ({
        leagueId: lg.id,
        name,
        slug: `${name.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const entries = await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: fall })))
    .returning({ id: teamSeason.id });
  const [a, b] = entries.map((e) => e.id) as [TeamSeasonId, TeamSeasonId];
  const park = required(
    (
      await db
        .insert(venue)
        .values({ leagueId: lg.id, name: "Park", slug: `park-${tag}` })
        .returning({ id: venue.id })
    )[0],
    "venue",
  );
  const f1 = required(
    (
      await db
        .insert(field)
        .values({ venueId: park.id, name: "Field 1" })
        .returning({ id: field.id })
    )[0],
    "field",
  );
  const slots = await db
    .insert(slot)
    .values(
      [1, 2, 3, 4, 5].map((day, i) => ({
        seasonId: fall,
        fieldId: f1.id,
        startsAt: new Date(`2026-09-0${day}T22:00:00Z`),
        endsAt: new Date(`2026-09-0${day}T23:00:00Z`),
        timeIndex: 0,
        // The fourth and fifth were rained out.
        status: i >= 3 ? ("cancelled" as const) : ("open" as const),
      })),
    )
    .returning({ id: slot.id });
  const slotAt = (i: number) => required(slots[i], "slot").id;
  const games = await db
    .insert(game)
    .values([
      {
        seasonId: fall,
        teamAId: a,
        teamBId: b,
        slotId: slotAt(0),
        status: "final",
        scoreA: 5,
        scoreB: 3,
        finalizedAt: new Date(),
      },
      {
        seasonId: fall,
        teamAId: b,
        teamBId: a,
        slotId: slotAt(1),
        status: "forfeit",
        forfeitBy: b,
      },
      { seasonId: fall, teamAId: a, teamBId: b, slotId: slotAt(2) },
    ])
    .returning({ id: game.id });
  const gameAt = (i: number) => required(games[i], "game").id;
  const version = (status: "published" | "draft", versionNo: number) =>
    db
      .insert(scheduleVersion)
      .values({
        seasonId: fall,
        versionNo,
        status,
        origin: "generated",
        inputSnapshot: sql`'{}'::jsonb`,
        publishedAt: status === "published" ? new Date() : null,
      })
      .returning({ id: scheduleVersion.id });
  const published = required((await version("published", 1))[0], "v1");
  const draft = required((await version("draft", 2))[0], "v2");
  await db.insert(gamePlacement).values([
    // The third game was placed on the fourth slot, which then rained out.
    { scheduleVersionId: published.id, gameId: gameAt(2), slotId: slotAt(3) },
    // A draft put it on the fifth; that draft never went out.
    { scheduleVersionId: draft.id, gameId: gameAt(2), slotId: slotAt(4) },
  ]);
  // Each team rates the other once a game.
  await db.insert(sportsmanshipRating).values([
    { gameId: gameAt(0), teamSeasonId: a, ratedTeamSeasonId: b, score: 5 },
    { gameId: gameAt(0), teamSeasonId: b, ratedTeamSeasonId: a, score: 4 },
    { gameId: gameAt(1), teamSeasonId: a, ratedTeamSeasonId: b, score: 3 },
  ]);
  const survey = required(
    (
      await db
        .insert(seasonSurvey)
        .values({ seasonId: fall, openedAt: new Date() })
        .returning({ id: seasonSurvey.id })
    )[0],
    "survey",
  );
  await db.insert(surveyAnswer).values(
    [5, 4, 4].map((rating) => ({
      surveyId: survey.id,
      rating,
      wouldReturn: "yes" as const,
    })),
  );
  return { fall, spring };
}

describe("reportExtras", () => {
  it("adds up survey, sportsmanship and games for each season", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const extras = await reportExtras(db, [w.fall, w.spring]);
      const fall = extras.get(w.fall);
      expect(fall?.surveyAnswers).toBe(3);
      expect(fall?.surveyAverage).toBeCloseTo(13 / 3);
      expect(fall?.sportsmanshipAverage).toBeCloseTo(4);
      // A forfeit counts as played; the game still to play doesn't.
      expect(fall?.gamesPlayed).toBe(2);
      // Only the slot in a schedule that went out counts as rained out.
      expect(fall?.rainedOut).toBe(1);
      // A season with nothing yet has no averages, not zeros.
      expect(extras.get(w.spring)).toEqual({
        surveyAverage: null,
        surveyAnswers: 0,
        sportsmanshipAverage: null,
        gamesPlayed: 0,
        rainedOut: 0,
      });
    });
  });

  it("reads nothing for no seasons", async () => {
    await inRolledBackDb(async (db) => {
      expect((await reportExtras(db, [])).size).toBe(0);
    });
  });
});
