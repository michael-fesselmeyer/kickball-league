import { updateTag } from "next/cache";

/**
 * How long the public schedule, standings and team pages are served as
 * static HTML (docs/architecture.md, section 3). A visit more than a minute
 * after the last render still gets the cached page at once and refreshes it
 * in the background; only a page nobody opened for a day is rendered while
 * the visitor waits. The actions people expect to see at once also expire
 * the page right away, through its tags.
 */
export const PUBLIC_PAGE_LIFE = {
  stale: 300,
  revalidate: 60,
  expire: 86_400,
} as const;

export const seasonTag = (seasonId: string) => `season:${seasonId}`;
export const teamTag = (teamSlug: string) => `team:${teamSlug}`;
export const gameTag = (gameId: string) => `game:${gameId}`;

/**
 * How long a game's live score is kept on the server between saves
 * (docs/architecture.md, section 3). Saving a half-inning expires it at once
 * through `gameTag`; the short refresh covers changes no action makes, such
 * as a score settling on its own.
 */
export const LIVE_SCORE_LIFE = {
  stale: 5,
  revalidate: 5,
  expire: 60,
} as const;

/** Seconds a CDN may keep a copy of a game's live score. */
export const LIVE_SCORE_CDN_SECONDS = 5;

/**
 * From a Server Action: the next request for any public page of this season,
 * including its teams' pages, renders fresh data instead of the cached copy.
 */
export function refreshSeasonPages(seasonId: string): void {
  updateTag(seasonTag(seasonId));
}
