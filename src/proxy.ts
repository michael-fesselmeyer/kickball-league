import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { viewRewrite } from "@/lib/view-rewrite";

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
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
  matcher: [
    "/app",
    "/app/:path*",
    // Views picked with a query string (src/lib/view-rewrite.ts).
    "/seasons/:season/schedule",
    "/teams/:team",
  ],
};
