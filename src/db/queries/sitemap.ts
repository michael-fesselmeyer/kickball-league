import { asc, desc, eq, max, ne } from "drizzle-orm";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/** Seasons with public pages: every season except drafts, newest first. */
export async function publicSeasons(db: Db) {
  return db
    .select({ slug: season.slug, updatedAt: season.updatedAt })
    .from(season)
    .where(ne(season.status, "draft"))
    .orderBy(desc(season.startsOn));
}

/** Teams with a public page: any team in a season that isn't a draft. */
export async function publicTeams(db: Db) {
  return db
    .selectDistinct({ slug: team.slug })
    .from(team)
    .innerJoin(teamSeason, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(season.id, teamSeason.seasonId))
    .where(ne(season.status, "draft"))
    .orderBy(asc(team.slug));
}

/**
 * Team pages for the sitemap: one per team with a public page, last changed
 * when the newest of its public seasons did (a new score or a new schedule
 * touches the season).
 */
export async function publicTeamPages(db: Db) {
  const rows = await db
    .select({ slug: team.slug, updatedAt: max(season.updatedAt) })
    .from(team)
    .innerJoin(teamSeason, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(season.id, teamSeason.seasonId))
    .where(ne(season.status, "draft"))
    .groupBy(team.slug)
    .orderBy(asc(team.slug));
  return rows.flatMap((r) =>
    r.updatedAt ? [{ slug: r.slug, updatedAt: r.updatedAt }] : [],
  );
}
