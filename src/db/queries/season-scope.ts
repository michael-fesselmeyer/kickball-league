import { and, eq, ne, type SQL } from "drizzle-orm";
import { season } from "../schema/season";

/**
 * Which seasons a query may show (ADR 0049). Public pages, feeds, the
 * sitemap, standings, records and awards read only the league's own seasons
 * past their draft; private leagues and tournaments are seen only by their
 * players, organizer and the league's admins, through the signed-in app.
 */

/** The league's own seasons, never a private one. */
export const leagueSeasons: SQL = eq(season.visibility, "league");

/** What a public page may show: a league season past its draft. */
export const publicSeasons: SQL = and(
  ne(season.status, "draft"),
  eq(season.visibility, "league"),
) as SQL;
