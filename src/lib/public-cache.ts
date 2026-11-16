import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { after } from "next/server";
import {
  DEFAULT_LEAGUE_SEGMENT,
  LEAGUE_PREFIX,
  type LeagueRef,
} from "@/domain/league/paths";

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

/** The site's name and status, as the paused notice shows them. */
export const SITE_TAG = "site";

/**
 * From the operator's Server Action: the site's status changed, so the
 * paused notice, which is static HTML, shows the new one on its next visit.
 */
export function refreshSiteNotice(): void {
  updateTag(SITE_TAG);
  revalidatePath("/paused");
}
/** Synced Instagram photos, on the home, team and event pages. */
export const PHOTOS_TAG = "photos";

/** The prerendered routes that show Instagram photos. */
const PHOTO_PAGE_ROUTES = [
  ["/l/[league]", "page"],
  ["/l/[league]/teams/[team]/[[...season]]", "page"],
  ["/l/[league]/events/[event]", "page"],
] as const;

/**
 * From a Server Action: pages with Instagram photos show an admin's change
 * on their next request. As with `refreshSeasonPages`, the prerendered
 * routes are expired by path too, so their shells don't serve the photos
 * they were built with; a photo an admin hides is gone at once.
 */
export function refreshPhotoPages(): void {
  updateTag(PHOTOS_TAG);
  for (const [route, type] of PHOTO_PAGE_ROUTES) revalidatePath(route, type);
}

/**
 * From a route handler (the sync job, the sign-in callback), where
 * `updateTag` is not allowed: the same pages refresh in the background.
 */
export function refreshPhotoPagesInBackground(): void {
  revalidateTag(PHOTOS_TAG, "max");
  for (const [route, type] of PHOTO_PAGE_ROUTES) revalidatePath(route, type);
}

/** Members' approved photos, on the team, event and game pages. */
export const MEMBER_PHOTOS_TAG = "member-photos";

/** The routes that show members' photos. */
const MEMBER_PHOTO_ROUTES = [
  ["/l/[league]/teams/[team]/[[...season]]", "page"],
  ["/l/[league]/events/[event]", "page"],
  ["/l/[league]/games/[game]", "page"],
] as const;

/**
 * From a Server Action: an approved, taken-down or deleted member photo
 * shows or goes on the next request for every page it is tagged to. As with
 * `refreshPhotoPages`, the prerendered routes are expired by path too, so
 * their shells don't serve the photos they were built with.
 */
export function refreshMemberPhotoPages(): void {
  updateTag(MEMBER_PHOTOS_TAG);
  for (const [route, type] of MEMBER_PHOTO_ROUTES) revalidatePath(route, type);
}

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
 * keep the cached data they were built with, under path tags only. The
 * schedule widget's prerendered files are expired with them.
 */
export const SEASON_PAGE_ROUTES = [
  "/l/[league]/seasons/[season]",
  "/l/[league]/teams/[team]",
  "/l/[league]/games/[game]",
  "/embed/schedule",
  // Shows the season's division rule sets (ADR 0062).
  "/l/[league]/rules",
];

/** A league's `[league]` segment: the default league's own, or its slug. */
const segmentOf = (league: LeagueRef | null): string =>
  !league || league.isDefault ? DEFAULT_LEAGUE_SEGMENT : league.slug;

/** Every park page: which fields the league holds there, and when. */
export const PARKS_TAG = "parks";
export const parkTag = (slug: string) => `park:${slug}`;

/** The park page's route, under each league (ADR 0048). */
const PARK_ROUTE = "/l/[league]/fields/[park]";

/**
 * From a Server Action: the park pages show a change to a permit, a field or
 * a park, or a season turning public, on their next request. As with the
 * other refreshes, the route is expired by path too, so its prerendered
 * pages don't serve the windows they were built with.
 */
export function refreshParkPages(): void {
  updateTag(PARKS_TAG);
  revalidatePath(PARK_ROUTE, "page");
}

/** The list of seasons on /seasons. */
export const SEASONS_TAG = "seasons";

/**
 * From a Server Action: the league history's shirt archive after a team's
 * shirt design changed. Only the history page reads it, so only it expires.
 */
export function refreshShirtArchive(league: LeagueRef, seasonId: string): void {
  updateTag(seasonTag(seasonId));
  // The league's own page right away, and every league's on its next visit.
  revalidatePath(`${LEAGUE_PREFIX}/${segmentOf(league)}/history`);
  revalidatePath("/l/[league]/history", "page");
}

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
  // The season list (/seasons) shows every season's name, dates and status,
  // one per league (ADR 0048).
  updateTag(SEASONS_TAG);
  // A season turning public, or draft again, changes which permits show.
  refreshParkPages();
  revalidatePath("/l/[league]/seasons", "page");
  for (const route of SEASON_PAGE_ROUTES) revalidatePath(route, "layout");
  expireSeasonPagesAgain(seasonId);
}

/**
 * How long after a season changes its pages are expired a second time. A
 * page that started rendering before the change, with the old data, can
 * finish after it and be saved as fresh, because the framework dates a
 * saved page by when it finished. Expiring again once such a render is done
 * drops that copy; a render slower than this can still leave the old page
 * up until it next revalidates (docs/architecture.md, section 3).
 */
export const SECOND_EXPIRY_MS = 5_000;

/** After the response, a second expiry of the season's tag and pages. */
function expireSeasonPagesAgain(seasonId: string): void {
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, SECOND_EXPIRY_MS));
    revalidateTag(seasonTag(seasonId), { expire: 0 });
    for (const route of SEASON_PAGE_ROUTES) revalidatePath(route, "layout");
  });
}

/**
 * From a Server Action: one game's live score changed (a half-inning, an
 * undo, who kicks first). Its cached reads expire, and so does its page,
 * which is static HTML kept per game (docs/architecture.md, section 3).
 */
export function refreshGamePage(
  gameId: string,
  league: LeagueRef | null,
): void {
  updateTag(gameTag(gameId));
  // The page as its league's route serves it (ADR 0048): the default
  // league's under its own segment, another league's under its slug.
  revalidatePath(`${LEAGUE_PREFIX}/${segmentOf(league)}/games/${gameId}`);
}

/**
 * From a Route Handler, where `updateTag` is not available: a game's score
 * changed, so its live score and its season's public pages expire at once,
 * as `refreshSeasonPages` and `updateTag(gameTag(id))` do from an action.
 */
export function expireGameScore(seasonId: string, gameId: string): void {
  revalidateTag(seasonTag(seasonId), { expire: 0 });
  revalidateTag(gameTag(gameId), { expire: 0 });
  for (const route of SEASON_PAGE_ROUTES) revalidatePath(route, "layout");
}

/** One player's public end-of-season card. */
export const seasonCardTag = (cardId: string) => `season-card:${cardId}`;
/** Every public card of a season, which rebuilding the cards changes. */
export const seasonCardsTag = (seasonId: string) => `season-cards:${seasonId}`;

/** The public card page's route. */
const SEASON_CARD_ROUTE = "/l/[league]/seasons/[season]/card/[card]";

/**
 * From a Server Action: a card made public or private, or every card of a
 * season rebuilt, shows on its next request. As with the other refreshes,
 * the route is expired by path too, so its prerendered pages don't serve
 * the card they were built with; a card made private is gone at once.
 */
export function refreshSeasonCards(
  scope: { cardId: string } | { seasonId: string },
): void {
  updateTag(
    "cardId" in scope
      ? seasonCardTag(scope.cardId)
      : seasonCardsTag(scope.seasonId),
  );
  revalidatePath(SEASON_CARD_ROUTE, "page");
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
  revalidatePath("/l/[league]/events/[event]", "page");
  if (themeWeek) {
    updateTag(THEME_WEEKS_TAG);
    revalidatePath("/l/[league]/seasons/[season]", "layout");
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
  revalidatePath("/l/[league]/sponsors", "layout");
}

/** The friends of the league directory, and its clubs on the events page. */
export const FRIENDS_TAG = "friends";

/**
 * From a Server Action: the friends directory, and the featured clubs on
 * the events page, show an admin's change on their next request. As with
 * the other refreshes, the routes are expired by path too, so their
 * prerendered pages don't serve the entries they were built with.
 */
export function refreshFriendPages(league: LeagueRef): void {
  updateTag(FRIENDS_TAG);
  // The league's own pages right away, as /friends and /events were before
  // leagues had their own paths (ADR 0048), and every league's on its next
  // visit.
  for (const page of ["friends", "events"]) {
    revalidatePath(`${LEAGUE_PREFIX}/${segmentOf(league)}/${page}`);
    revalidatePath(`/l/[league]/${page}`, "page");
  }
}

/** Every league's rules page and its change log (ADR 0062). */
export const RULES_TAG = "rules";

/**
 * From a Server Action: an admin published a change to a league's rules.
 * The league's page shows it at once, and every league's page on its next
 * visit, as the friends pages do (ADR 0048).
 */
export function refreshRulesPage(league: LeagueRef): void {
  updateTag(RULES_TAG);
  revalidatePath(`${LEAGUE_PREFIX}/${segmentOf(league)}/rules`);
  revalidatePath("/l/[league]/rules", "page");
}

/** Every league's open interest form (docs/data-model.md, section 2.7). */
export const INTEREST_TAG = "interest";

/**
 * From a Server Action: an admin opened, changed or closed an interest form,
 * or an option went ahead. The league's page shows it at once, and every
 * league's page on its next visit, as the rules pages do (ADR 0048).
 */
export function refreshInterestPage(league: LeagueRef): void {
  updateTag(INTEREST_TAG);
  revalidatePath(`${LEAGUE_PREFIX}/${segmentOf(league)}/interest`);
  revalidatePath("/l/[league]/interest", "page");
}
