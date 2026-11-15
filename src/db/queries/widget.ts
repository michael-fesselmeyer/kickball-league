import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import type { LeagueId, SeasonId } from "@/domain/ids";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/**
 * One league's public seasons for its schedule widget, newest first, with the
 * league's time zone. `widgetSeason` picks the one it follows.
 */
export function widgetSeasons(db: Db, leagueId: LeagueId) {
  return db
    .select({
      id: season.id,
      name: season.name,
      slug: season.slug,
      status: season.status,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(and(eq(season.leagueId, leagueId), ne(season.status, "draft")))
    .orderBy(desc(season.startsOn));
}

/**
 * The teams in a season, by name, for the "Get the widget" page: each one
 * with a public team page. Withdrawn entries and deleted teams are left out.
 */
export function widgetTeams(db: Db, seasonId: SeasonId) {
  return db
    .select({ name: team.name, slug: team.slug })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        ne(teamSeason.status, "withdrawn"),
        isNull(team.deletedAt),
      ),
    )
    .orderBy(asc(team.name));
}
