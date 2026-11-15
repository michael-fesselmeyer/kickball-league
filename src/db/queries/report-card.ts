import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { SeasonId } from "@/domain/ids";
import { sportsmanshipRating } from "../schema/discipline";
import { game, slot } from "../schema/game";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { seasonSurvey, surveyAnswer } from "../schema/survey";
import { teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/**
 * What the season report card needs beyond the owner dashboard's numbers
 * (issue #371): survey ratings, sportsmanship, and games played against
 * game times rained out. Three grouped reads for any number of seasons,
 * all at once. Totals and averages only.
 */

export type ReportExtras = {
  surveyAverage: number | null;
  surveyAnswers: number;
  sportsmanshipAverage: number | null;
  gamesPlayed: number;
  rainedOut: number;
};

const EMPTY: ReportExtras = {
  surveyAverage: null,
  surveyAnswers: 0,
  sportsmanshipAverage: null,
  gamesPlayed: 0,
  rainedOut: 0,
};

const avg = (value: string | number | null) =>
  value === null ? null : Number(value);

export async function reportExtras(
  db: Db,
  seasonIds: readonly SeasonId[],
): Promise<Map<SeasonId, ReportExtras>> {
  if (seasonIds.length === 0) return new Map();
  const ids = [...seasonIds];
  const [surveys, ratings, played, rained] = await Promise.all([
    db
      .select({
        seasonId: seasonSurvey.seasonId,
        average: sql<string | null>`avg(${surveyAnswer.rating})`,
        answers: sql<number>`count(${surveyAnswer.id})`.mapWith(Number),
      })
      .from(seasonSurvey)
      .leftJoin(surveyAnswer, eq(surveyAnswer.surveyId, seasonSurvey.id))
      .where(inArray(seasonSurvey.seasonId, ids))
      .groupBy(seasonSurvey.seasonId),
    db
      .select({
        seasonId: teamSeason.seasonId,
        average: sql<string | null>`avg(${sportsmanshipRating.score})`,
      })
      .from(sportsmanshipRating)
      .innerJoin(
        teamSeason,
        eq(teamSeason.id, sportsmanshipRating.ratedTeamSeasonId),
      )
      .where(inArray(teamSeason.seasonId, ids))
      .groupBy(teamSeason.seasonId),
    db
      .select({
        seasonId: game.seasonId,
        games: sql<number>`count(*)`.mapWith(Number),
      })
      .from(game)
      .where(
        and(
          inArray(game.seasonId, ids),
          inArray(game.status, ["final", "forfeit"]),
        ),
      )
      .groupBy(game.seasonId),
    // A rain-out cancels a slot and moves its game to a makeup, so count
    // the cancelled slots that held a game in a schedule that went out
    // (published, or published and since replaced). Drafts don't count.
    db
      .select({
        seasonId: slot.seasonId,
        slots: sql<number>`count(distinct ${slot.id})`.mapWith(Number),
      })
      .from(slot)
      .innerJoin(gamePlacement, eq(gamePlacement.slotId, slot.id))
      .innerJoin(
        scheduleVersion,
        eq(scheduleVersion.id, gamePlacement.scheduleVersionId),
      )
      .where(
        and(
          inArray(slot.seasonId, ids),
          eq(slot.status, "cancelled"),
          ne(scheduleVersion.status, "draft"),
        ),
      )
      .groupBy(slot.seasonId),
  ]);
  const out = new Map<SeasonId, ReportExtras>(
    ids.map((id) => [id, { ...EMPTY }]),
  );
  const at = (id: SeasonId) => out.get(id) ?? { ...EMPTY };
  for (const s of surveys)
    out.set(s.seasonId, {
      ...at(s.seasonId),
      surveyAverage: s.answers > 0 ? avg(s.average) : null,
      surveyAnswers: s.answers,
    });
  for (const r of ratings)
    out.set(r.seasonId, {
      ...at(r.seasonId),
      sportsmanshipAverage: avg(r.average),
    });
  for (const g of played)
    out.set(g.seasonId, { ...at(g.seasonId), gamesPlayed: g.games });
  for (const r of rained)
    out.set(r.seasonId, { ...at(r.seasonId), rainedOut: r.slots });
  return out;
}
