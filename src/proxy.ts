import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_LEAGUE_SEGMENT,
  LEAGUE_PREFIX,
  leagueRoute,
} from "@/domain/league/paths";
import { reachableWhilePaused } from "@/domain/platform/operator";
import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  localizedPath,
  SIGNED_IN_LOCALES,
} from "@/i18n/locales";
import { LANGUAGE_COOKIE } from "@/i18n/cookie";
import { isTranslated } from "@/i18n/pages";
import { splitLocale } from "@/i18n/routing";
import { siteForProxy } from "@/lib/platform/site";
import { viewRewrite } from "@/lib/view-rewrite";

/**
 * Every page lives under `src/app/[lang]` (ADR 0065). An English address
 * has no language prefix (`/faq` is served from `/en/faq`); another
 * language's starts with its code (`/es/faq`). Route handlers at the top of
 * src/app (feeds, media, short links, the schedule widget's files) are
 * served as they are.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (passesThrough(pathname)) return NextResponse.next();
  const { locale, rest, prefixed } = splitLocale(pathname);
  // English has no prefix: "/en/faq" typed by hand goes to "/faq". A page
  // not yet translated into the language goes to the English page.
  if (prefixed && (locale === DEFAULT_LOCALE || !isTranslated(locale, rest)))
    return NextResponse.redirect(
      new URL(`${rest}${search}`, request.url),
      locale === DEFAULT_LOCALE ? 308 : 307,
    );
  // While the operator has the site paused, public pages show a neutral
  // notice. Signing in, the app (where owners export their data) and the
  // operator console stay reachable. See ADR 0009.
  // Files (calendar feeds, share images) are never swapped for the notice.
  let defaultSlug: string | null = null;
  if (!reachableWhilePaused(rest) && !rest.includes(".")) {
    const site = await siteForProxy();
    if (site?.status === "paused")
      return rewriteTo(request, `/${locale}/paused`);
    defaultSlug = site?.slug ?? null;
  }
  if (rest === "/app" || rest.startsWith("/app/")) {
    // Signed-in pages follow the person's own language, not the address.
    if (prefixed)
      return NextResponse.redirect(new URL(`${rest}${search}`, request.url));
    return signedInOnly(request);
  }
  return leaguePage(request, locale, rest, defaultSlug);
}

/** Route handlers at the top of src/app, outside the language tree. */
const OUTSIDE_LANGUAGES =
  /^\/(?:api|r|icons|media|embed|events\/personal)(?:\/|$)/;

const passesThrough = (pathname: string) => OUTSIDE_LANGUAGES.test(pathname);

/**
 * Serve `path` instead, keeping the address. Signed-in and site pages keep
 * the query string they read; a league's public pages never read it (its
 * view is in the path by now), so theirs is dropped and each stays one
 * static page.
 */
function rewriteTo(request: NextRequest, path: string, keepQuery = true) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  if (!keepQuery) url.search = "";
  return NextResponse.rewrite(url);
}

const OTHER_LEAGUE = /^\/l\/([^/]+)(\/.*)?$/;

/**
 * Public pages are one route tree per league, `src/app/[lang]/l/[league]`
 * (ADR 0048). The default league's own URLs are rewritten onto it as
 * `_default`; another league's `/l/<slug>/...` is served as it is. Either
 * way the view a query string picks becomes a path segment
 * (src/lib/view-rewrite.ts). The address in the browser stays the same,
 * and the league and the language come from the path alone. The site's
 * other pages are served from the language tree as they are.
 */
function leaguePage(
  request: NextRequest,
  locale: Locale,
  rest: string,
  defaultSlug: string | null,
) {
  const { searchParams, search } = request.nextUrl;
  const route = leagueRoute(rest);
  if (route?.kind === "redirect")
    return NextResponse.redirect(
      new URL(`${localizedPath(locale, route.path)}${search}`, request.url),
      308,
    );
  const other = OTHER_LEAGUE.exec(rest);
  // The default league has one address. Redirecting here, over HTTP, spares
  // the browser the page's own redirect, whose follow-up request the client
  // router can't resolve and answers with a second full page load (issue
  // 425). The page still redirects, for a server that can't tell.
  if (other && defaultSlug !== null && other[1] === defaultSlug)
    return NextResponse.redirect(
      new URL(
        `${localizedPath(locale, other[2] ?? "/")}${search}`,
        request.url,
      ),
      308,
    );
  const base = other
    ? `${LEAGUE_PREFIX}/${other[1]}`
    : route?.kind === "rewrite"
      ? `${LEAGUE_PREFIX}/${DEFAULT_LEAGUE_SEGMENT}`
      : null;
  if (base === null) return rewriteTo(request, `/${locale}${rest}`);
  const inLeague = other ? (other[2] ?? "/") : rest;
  const view = viewRewrite(inLeague, searchParams) ?? inLeague;
  const target = view === "/" ? base : `${base}${view}`;
  return rewriteTo(request, `/${locale}${target}`, false);
}

/** The language a signed-in page is shown in, from the person's setting. */
function signedInLocale(request: NextRequest): Locale {
  const chosen = request.cookies.get(LANGUAGE_COOKIE)?.value;
  return isLocale(chosen) && SIGNED_IN_LOCALES.includes(chosen)
    ? chosen
    : DEFAULT_LOCALE;
}

/**
 * Coarse gate for signed-in pages: no session cookie, no /app. It checks only
 * that a cookie exists, never whether it is valid, so it is never the only
 * check. Every page and Server Action behind it verifies the session itself.
 * See docs/architecture.md, section 4 ("Checks", rule 2).
 */
function signedInOnly(request: NextRequest) {
  if (getSessionCookie(request))
    return rewriteTo(
      request,
      `/${signedInLocale(request)}${request.nextUrl.pathname}`,
    );

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(signIn);
}

export const config = {
  // Every page (for the paused notice and the language and league
  // rewrites), but not API routes, build assets or files such as icons and
  // the manifest; and the files that belong to the default league's pages,
  // which are rewritten like them.
  matcher: [
    "/((?!api/|_next/|.*\\..*).*)",
    "/teams/:team/calendar.ics",
    "/teams/:team/share.png",
    "/games/:game/share.png",
    "/seasons/:season/card/:card/share.png",
    "/events/calendar.ics",
    "/events/:event/calendar.ics",
  ],
};
