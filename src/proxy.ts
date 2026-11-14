import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_LEAGUE_SEGMENT,
  LEAGUE_PREFIX,
  leagueRoute,
} from "@/domain/league/paths";
import { reachableWhilePaused } from "@/domain/platform/operator";
import { siteForProxy } from "@/lib/platform/site";
import { viewRewrite } from "@/lib/view-rewrite";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // While the operator has the site paused, public pages show a neutral
  // notice. Signing in, the app (where owners export their data) and the
  // operator console stay reachable. See ADR 0009.
  // Files (calendar feeds, share images) are never swapped for the notice.
  if (!reachableWhilePaused(pathname) && !pathname.includes(".")) {
    const site = await siteForProxy();
    if (site?.status === "paused")
      return NextResponse.rewrite(new URL("/paused", request.url));
  }
  if (pathname === "/app" || pathname.startsWith("/app/"))
    return signedInOnly(request);

  return leaguePage(request);
}

const OTHER_LEAGUE = /^\/l\/([^/]+)(\/.*)?$/;

/**
 * Public pages are one route tree per league, `src/app/l/[league]` (ADR
 * 0044). The default league's own URLs are rewritten onto it as `_default`;
 * another league's `/l/<slug>/...` is served as it is. Either way the view a
 * query string picks becomes a path segment (src/lib/view-rewrite.ts). The
 * address in the browser stays the same, and the league comes from the
 * path alone.
 */
function leaguePage(request: NextRequest) {
  const { pathname, searchParams, search } = request.nextUrl;
  const route = leagueRoute(pathname);
  if (route?.kind === "redirect")
    return NextResponse.redirect(
      new URL(`${route.path}${search}`, request.url),
      308,
    );
  const other = OTHER_LEAGUE.exec(pathname);
  const base = other
    ? `${LEAGUE_PREFIX}/${other[1]}`
    : route?.kind === "rewrite"
      ? `${LEAGUE_PREFIX}/${DEFAULT_LEAGUE_SEGMENT}`
      : null;
  if (base === null) return NextResponse.next();
  const rest = other ? (other[2] ?? "/") : pathname;
  const view = viewRewrite(rest, searchParams) ?? rest;
  const target = view === "/" ? base : `${base}${view}`;
  return target === pathname
    ? NextResponse.next()
    : NextResponse.rewrite(new URL(target, request.url));
}

/**
 * Coarse gate for signed-in pages: no session cookie, no /app. It checks only
 * that a cookie exists, never whether it is valid, so it is never the only
 * check. Every page and Server Action behind it verifies the session itself.
 * See docs/architecture.md, section 4 ("Checks", rule 2).
 */
function signedInOnly(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(signIn);
}

export const config = {
  // Every page (for the paused notice and the league rewrite), but not API
  // routes, build assets or files such as icons and the manifest; and the
  // files that belong to the default league's pages, which are rewritten
  // like them.
  matcher: [
    "/((?!api/|_next/|.*\\..*).*)",
    "/teams/:team/calendar.ics",
    "/teams/:team/share.png",
    "/games/:game/share.png",
    "/events/calendar.ics",
    "/events/:event/calendar.ics",
  ],
};
