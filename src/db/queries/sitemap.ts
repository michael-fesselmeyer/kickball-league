import { and, asc, desc, eq, max, ne, notInArray } from "drizzle-orm";
import type { LeagueId } from "@/domain/ids";
import { game } from "../schema/game";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import type { Db } from "./schedule";
import { publicSeasons as publicScope } from "./season-scope";

/** A league's seasons with public pages: every season except drafts, newest first. */
export async function publicSeasons(db: Db, leagueId: LeagueId) {
  return db
    .select({
      slug: season.slug,
      name: season.name,
      updatedAt: season.updatedAt,
    })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), publicScope))
    .orderBy(desc(season.startsOn));
}

/** A league's teams with a public page: any team in a season that isn't a draft. */
export async function publicTeams(db: Db, leagueId: LeagueId) {
  return db
    .selectDistinct({ slug: team.slug })
    .from(team)
    .innerJoin(teamSeason, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(season.id, teamSeason.seasonId))
    .where(and(eq(team.leagueId, leagueId), publicScope))
    .orderBy(asc(team.slug));
}

/**
 * Team pages for the sitemap: one per team with a public page, last changed
 * when the newest of its public seasons did (a new score or a new schedule
 * touches the season).
 */
export async function publicTeamPages(db: Db, leagueId: LeagueId) {
  const rows = await db
    .select({ slug: team.slug, updatedAt: max(season.updatedAt) })
    .from(team)
    .innerJoin(teamSeason, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(season.id, teamSeason.seasonId))
    .where(and(eq(team.leagueId, leagueId), publicScope))
    .groupBy(team.slug)
    .orderBy(asc(team.slug));
  return rows.flatMap((r) =>
    r.updatedAt ? [{ slug: r.slug, updatedAt: r.updatedAt }] : [],
  );
}

/**
 * A league's games on a published schedule of a season still being played (open for
 * registration, under way or in its playoffs): the game pages worth having
 * ready before anyone asks. A finished season's games render on their first
 * visit and are kept.
 */
export async function currentPublicGames(db: Db, leagueId: LeagueId) {
  return db
    .selectDistinct({ id: game.id })
    .from(gamePlacement)
    .innerJoin(
      scheduleVersion,
      and(
        eq(gamePlacement.scheduleVersionId, scheduleVersion.id),
        eq(scheduleVersion.status, "published"),
      ),
    )
    .innerJoin(game, eq(gamePlacement.gameId, game.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .where(
      and(
        eq(season.leagueId, leagueId),
        notInArray(season.status, ["draft", "completed"]),
        publicScope,
      ),
    )
    .orderBy(asc(game.id));
}

/**
 * The /seasons page: every season with public pages in a league, newest
 * first, with what a visitor needs to pick one.
 */
export async function seasonList(db: Db, leagueId: LeagueId) {
  return db
    .select({
      id: season.id,
      name: season.name,
      slug: season.slug,
      status: season.status,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
    })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), publicScope))
    .orderBy(desc(season.startsOn));
}
