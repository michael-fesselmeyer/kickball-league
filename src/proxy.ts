import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { reachableWhilePaused } from "@/domain/platform/operator";
import { currentSite } from "@/lib/platform/site";
import { viewRewrite } from "@/lib/view-rewrite";

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  // While the operator has the site paused, public pages show a neutral
  // notice. Signing in, the app (where owners export their data) and the
  // operator console stay reachable. See ADR 0009.
  if (!reachableWhilePaused(pathname)) {
    const site = await currentSite();
    if (site?.status === "paused")
      return NextResponse.rewrite(new URL("/paused", request.url));
  }
  if (pathname === "/app" || pathname.startsWith("/app/"))
    return signedInOnly(request);

  const view = viewRewrite(pathname, searchParams);
  return view
    ? NextResponse.rewrite(new URL(view, request.url))
    : NextResponse.next();
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
  // Every page (for the paused notice), but not API routes, build assets or
  // files such as icons and the manifest.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
