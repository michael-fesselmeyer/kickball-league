import { revalidatePath, updateTag } from "next/cache";

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
/** Every sponsor page and the sponsors list: there are only a handful. */
export const SPONSORS_TAG = "sponsors";
/** Synced Instagram photos, on the home page and team pages. */
export const PHOTOS_TAG = "photos";

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
 * The public routes whose pages show a season's data. Their shells (the
 * prerendered part of a page that is served at once while the rest renders)
 * keep the cached data they were built with, under path tags only.
 */
export const SEASON_PAGE_ROUTES = ["/seasons/[season]", "/teams/[team]"];

/**
 * From a Server Action: the next request for any public page of this season,
 * including its teams' pages, renders fresh data instead of the cached copy.
 *
 * The season tag expires the pages and the cached data. The routes are also
 * expired by path, because a page whose tag expired is answered from its
 * route's shell, and the data saved in that shell is not checked against the
 * season tag (docs/architecture.md, section 3).
 */
export function refreshSeasonPages(seasonId: string): void {
  updateTag(seasonTag(seasonId));
  for (const route of SEASON_PAGE_ROUTES) revalidatePath(route, "layout");
}

/** The events list, the events calendar feed and every event page. */
export const EVENTS_TAG = "events";
export const eventTag = (slug: string) => `event:${slug}`;
/** The theme weeks the public schedule marks on its game days. */
export const THEME_WEEKS_TAG = "theme-weeks";

/**
 * From a Server Action: the events pages show the change at once. A theme
 * week change also refreshes the public schedules that show it. As with
 * `refreshSeasonPages`, the prerendered routes are expired by path too, so
 * their shells don't serve the data they were built with.
 */
export function refreshEventPages(
  slug: string,
  { themeWeek = false }: { themeWeek?: boolean } = {},
): void {
  updateTag(EVENTS_TAG);
  updateTag(eventTag(slug));
  revalidatePath("/events/[event]", "page");
  if (themeWeek) {
    updateTag(THEME_WEEKS_TAG);
    revalidatePath("/seasons/[season]", "layout");
  }
}

/**
 * From a Server Action: the sponsors list and every sponsor page render
 * fresh data on their next request, after a sponsor, deal or team of the
 * week changes. As with `refreshSeasonPages`, the routes are expired by path
 * too, so their prerendered shells don't serve the data they were built with.
 */
export function refreshSponsorPages(): void {
  updateTag(SPONSORS_TAG);
  revalidatePath("/sponsors", "layout");
}
