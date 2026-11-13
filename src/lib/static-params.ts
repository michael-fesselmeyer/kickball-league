import { db } from "@/db/client";
import { publicDivisionPages } from "@/db/queries/divisions";
import { publicEventSlugs } from "@/db/queries/events";
import { publishedSummarySeasons } from "@/db/queries/owner-dashboard";
import { publicSeasons, publicTeams } from "@/db/queries/sitemap";
import { publicSponsorPages } from "@/db/queries/sponsors";

/**
 * A slug no season can have (slugs are lowercase words joined by hyphens),
 * so its page renders as not found. With Cache Components a dynamic route
 * must list at least one param at build time.
 */
export const NO_SEASON = "_";

/** As NO_SEASON, for team pages. */
export const NO_TEAM = "_";

/** As NO_SEASON, for sponsor pages. */
export const NO_SPONSOR = "_";

/**
 * The public seasons to prerender at build time, so the first visit to
 * their schedule and standings is served as static HTML instead of waiting
 * on the database (docs/architecture.md, section 3).
 *
 * A build with no database to read (the CI build job) lists only the
 * placeholder; those pages are then rendered on their first visit and cached.
 */
export async function publicSeasonParams(): Promise<{ season: string }[]> {
  try {
    const seasons = await publicSeasons(db);
    if (seasons.length > 0) return seasons.map((s) => ({ season: s.slug }));
  } catch (error) {
    console.warn(
      `[build] No seasons prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [{ season: NO_SEASON }];
}

/**
 * The public teams to prerender at build time (their current-season view),
 * on the same terms as `publicSeasonParams`.
 */
export async function publicTeamParams(): Promise<{ team: string }[]> {
  try {
    const teams = await publicTeams(db);
    if (teams.length > 0) return teams.map((t) => ({ team: t.slug }));
  } catch (error) {
    console.warn(
      `[build] No teams prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [{ team: NO_TEAM }];
}

/** As NO_SEASON, for event pages. */
export const NO_EVENT = "_";

/** The event pages to prerender at build time, on the same terms. */
export async function publicEventParams(): Promise<{ event: string }[]> {
  try {
    const events = await publicEventSlugs(db);
    if (events.length > 0) return events.map((e) => ({ event: e.slug }));
  } catch (error) {
    console.warn(
      `[build] No events prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [{ event: NO_EVENT }];
}

/** The sponsor pages to prerender at build time, on the same terms. */
export async function publicSponsorParams(): Promise<{ sponsor: string }[]> {
  try {
    const sponsors = await publicSponsorPages(db);
    if (sponsors.length > 0) return sponsors.map((s) => ({ sponsor: s.slug }));
  } catch (error) {
    console.warn(
      `[build] No sponsors prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [{ sponsor: NO_SPONSOR }];
}

/**
 * The seasons whose money summary is published, to prerender at build time,
 * on the same terms. A summary published later renders on its first visit.
 */
export async function moneySummaryParams(): Promise<{ season: string }[]> {
  try {
    const seasons = await publishedSummarySeasons(db);
    if (seasons.length > 0) return seasons.map((s) => ({ season: s.slug }));
  } catch (error) {
    console.warn(
      `[build] No money summaries prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [{ season: NO_SEASON }];
}

/** As NO_SEASON, for division pages. */
export const NO_DIVISION = "_";

/**
 * The divisions of every public season, to prerender their schedules at
 * build time, on the same terms as `publicSeasonParams`.
 */
export async function publicDivisionParams(): Promise<
  { season: string; division: string }[]
> {
  try {
    const pages = await publicDivisionPages(db);
    if (pages.length > 0) return pages;
  } catch (error) {
    console.warn(
      `[build] No divisions prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [{ season: NO_SEASON, division: NO_DIVISION }];
}
