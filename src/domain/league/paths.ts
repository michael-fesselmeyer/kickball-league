/**
 * Where each league's public pages live (ADR 0048).
 *
 * The default league keeps the site's own URLs (`/seasons/fall-2026/schedule`);
 * every other league's pages live under `/l/<slug>`
 * (`/l/football/seasons/fall-2026/schedule`). The pages themselves are one
 * route tree, `src/app/l/[league]`: the proxy rewrites the default league's
 * URLs onto it with the reserved segment `_default`, which no league slug
 * can be (slugs are lowercase letters, digits and hyphens). So a public page
 * always knows its league from its path alone, never from a cookie, a header
 * or the query string, and stays static.
 */

/** The `[league]` segment the default league's URLs are rewritten to. */
export const DEFAULT_LEAGUE_SEGMENT = "_default";

/** The prefix of every other league's public pages. */
export const LEAGUE_PREFIX = "/l";

/** First path segments that belong to a league's public pages. */
export const LEAGUE_PAGE_ROOTS = [
  "seasons",
  "teams",
  "games",
  "events",
  "sponsors",
  "history",
  "records",
  "friends",
  "rules",
  "fields",
  "interest",
] as const;

const ROOTS: ReadonlySet<string> = new Set(LEAGUE_PAGE_ROOTS);

/** What a link needs to know about its league. */
export type LeagueRef = { slug: string; isDefault: boolean };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isLeagueSlug = (value: string): boolean =>
  value.length <= 40 && SLUG.test(value);

/** "" for the default league, `/l/<slug>` for any other. */
export function leagueBase(league: LeagueRef): string {
  return league.isDefault ? "" : `${LEAGUE_PREFIX}/${league.slug}`;
}

/**
 * The public URL of `path` (which starts with "/") in `league`. The home
 * page of a league other than the default is `/l/<slug>`, without a slash.
 */
export function leagueHref(league: LeagueRef, path: string): string {
  const base = leagueBase(league);
  if (!base) return path;
  return path === "/" ? base : `${base}${path}`;
}

export type LeagueRoute =
  /** Serve this internal path instead, keeping the address. */
  | { kind: "rewrite"; path: string }
  /** Send the visitor here (a permanent redirect). */
  | { kind: "redirect"; path: string };

/**
 * How the proxy maps a public address onto the league route tree, from the
 * path alone. The default league's pages are rewritten to `_default`;
 * `/l/_default/...` typed by hand redirects back to the real address.
 * Anything else, including `/l/<slug>/...`, is served as it is.
 */
export function leagueRoute(pathname: string): LeagueRoute | null {
  const segments = pathname.split("/");
  // ["", "seasons", ...] or ["", "l", "_default", ...]
  if (segments[1] === "l" && segments[2] === DEFAULT_LEAGUE_SEGMENT) {
    const rest = segments.slice(3).join("/");
    return { kind: "redirect", path: `/${rest}` };
  }
  if (pathname === "/")
    return {
      kind: "rewrite",
      path: `${LEAGUE_PREFIX}/${DEFAULT_LEAGUE_SEGMENT}`,
    };
  if (ROOTS.has(segments[1] ?? ""))
    return {
      kind: "rewrite",
      path: `${LEAGUE_PREFIX}/${DEFAULT_LEAGUE_SEGMENT}${pathname}`,
    };
  return null;
}

/**
 * The league a public path belongs to: its slug, `null` for the default
 * league, or `undefined` when the path is not a league's page (sign-in, the
 * app, the operator console).
 */
export function leagueOfPath(pathname: string): string | null | undefined {
  const segments = pathname.split("/");
  if (segments[1] === "l" && segments[2]) {
    return segments[2] === DEFAULT_LEAGUE_SEGMENT ? null : segments[2];
  }
  if (pathname === "/" || ROOTS.has(segments[1] ?? "")) return null;
  return undefined;
}
