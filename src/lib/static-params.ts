import { db } from "@/db/client";
import { publicDivisionPages } from "@/db/queries/divisions";
import { publicEventSlugs } from "@/db/queries/events";
import { leagueBySegment } from "@/db/queries/leagues";
import { publishedSummarySeasons } from "@/db/queries/owner-dashboard";
import { publicCardIds } from "@/db/queries/season-cards";
import {
  currentPublicGames,
  publicSeasons,
  publicTeams,
} from "@/db/queries/sitemap";
import { publicSponsorPages } from "@/db/queries/sponsors";
import { publishedAwardSeasons } from "@/db/queries/stat-awards";
import type { LeagueId } from "@/domain/ids";

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

/** As NO_SEASON, for event pages. */
export const NO_EVENT = "_";

/** As NO_SEASON, for division pages. */
export const NO_DIVISION = "_";

/**
 * As NO_SEASON, for game pages: not a UUID, so `parseId` refuses it and the
 * page renders as not found.
 */
export const NO_GAME = "_";

/** As NO_SEASON, for a player's public season card. */
export const NO_CARD = "_";

/** The `[league]` segment a child route's generateStaticParams is given. */
export type LeagueParams = { params: { league: string } };

/**
 * One league's pages to prerender at build time (ADR 0048), so the first
 * visit is served as static HTML instead of waiting on the database
 * (docs/architecture.md, section 3).
 *
 * A build with no database to read (the CI build job), or a league with
 * nothing of the kind yet, lists only the placeholder; those pages are then
 * rendered on their first visit and cached.
 */
async function forLeague<T>(
  segment: string,
  what: string,
  list: (leagueId: LeagueId) => Promise<T[]>,
  placeholder: T,
): Promise<T[]> {
  try {
    const league = await leagueBySegment(db, segment);
    const found = league ? await list(league.id) : [];
    if (found.length > 0) return found;
  } catch (error) {
    console.warn(
      `[build] No ${what} prerendered: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  return [placeholder];
}

export const publicSeasonParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "seasons",
    async (id) =>
      (await publicSeasons(db, id)).map((s) => ({ season: s.slug })),
    { season: NO_SEASON },
  );

export const publicTeamParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "teams",
    async (id) => (await publicTeams(db, id)).map((t) => ({ team: t.slug })),
    { team: NO_TEAM },
  );

export const publicEventParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "events",
    async (id) =>
      (await publicEventSlugs(db, id)).map((e) => ({ event: e.slug })),
    { event: NO_EVENT },
  );

export const publicSponsorParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "sponsors",
    async (id) =>
      (await publicSponsorPages(db, id)).map((s) => ({ sponsor: s.slug })),
    { sponsor: NO_SPONSOR },
  );

/** Seasons whose money summary is published; one published later renders on its first visit. */
export const moneySummaryParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "money summaries",
    async (id) =>
      (await publishedSummarySeasons(db, id)).map((s) => ({ season: s.slug })),
    { season: NO_SEASON },
  );

/** The divisions of every public season, to prerender their schedules. */
export const publicDivisionParams = ({ params }: LeagueParams) =>
  forLeague(params.league, "divisions", (id) => publicDivisionPages(db, id), {
    season: NO_SEASON,
    division: NO_DIVISION,
  });

/**
 * The games of a league's seasons still being played. Any other game is
 * rendered in full on its first visit and kept.
 */
export const publicGameParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "games",
    async (id) =>
      (await currentPublicGames(db, id)).map((g) => ({ game: g.id })),
    { game: NO_GAME },
  );

/** Seasons whose stat awards are published; awards published later render on their first visit. */
export const statAwardParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "awards pages",
    async (id) =>
      (await publishedAwardSeasons(db, id)).map((s) => ({ season: s.slug })),
    { season: NO_SEASON },
  );

/** Public season cards; a card made public later renders on its first visit. */
export const publicCardParams = ({ params }: LeagueParams) =>
  forLeague(
    params.league,
    "season cards",
    async (id) =>
      (await publicCardIds(db, id)).map((c) => ({
        season: c.seasonSlug,
        card: c.id,
      })),
    { season: NO_SEASON, card: NO_CARD },
  );
