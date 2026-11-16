import { NextResponse } from "next/server";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import {
  HANDOFF_FRESH_SECONDS,
  HANDOFF_START_COOKIE,
  HANDOFF_START_COOKIE_PATH,
  isBase64Url256,
  startCookieValue,
} from "@/lib/auth/app-handoff";
import { isGoogleEnabled } from "@/lib/auth/google";
import { parseSetCookie, requestGoogleSignIn } from "@/lib/auth/request-google";

/**
 * Starts Google sign-in for the iOS and Android apps (ADR 0075). The app
 * opens this address in the system browser sheet with the challenge for a
 * verifier it keeps. The sheet goes to Google, back to Better Auth's
 * callback, and on to `/api/auth/app-sign-in/handoff`, which sends it back
 * to the app with a one-time code. The start cookie ties that return to
 * this start, in this browser.
 */
export async function GET(request: Request): Promise<Response> {
  const site = new URL(env.BETTER_AUTH_URL);
  const failed = (reason: string) =>
    NextResponse.redirect(
      new URL(`/sign-in?${new URLSearchParams({ app: reason })}`, site),
      303,
    );
  const challenge = new URL(request.url).searchParams.get("challenge");
  if (!isBase64Url256(challenge) || !isGoogleEnabled(env))
    return failed("expired");

  const start = await requestGoogleSignIn(auth.handler, {
    baseURL: env.BETTER_AUTH_URL,
    callbackURL: `/api/auth/app-sign-in/handoff?${new URLSearchParams({ challenge })}`,
    headers: request.headers,
  }).catch(() => ({ outcome: "failed" as const }));
  if (start.outcome !== "redirect") return failed(start.outcome);

  const response = NextResponse.redirect(start.url, 303);
  for (const header of start.setCookies) {
    const cookie = parseSetCookie(header);
    if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  response.cookies.set(
    HANDOFF_START_COOKIE,
    startCookieValue(challenge, Date.now()),
    {
      path: HANDOFF_START_COOKIE_PATH,
      maxAge: HANDOFF_FRESH_SECONDS,
      httpOnly: true,
      secure: site.protocol === "https:",
      sameSite: "lax",
    },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
