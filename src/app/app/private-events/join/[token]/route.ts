import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { seasonForInvite } from "@/db/queries/private-events";
import {
  PRIVATE_INVITE_COOKIE,
  PRIVATE_INVITE_DAYS,
} from "@/lib/private-events/invite";

/**
 * A private league or tournament's invite link (ADR 0049). It remembers the
 * invite in a cookie and opens the season's registration, where a captain
 * signs in and enters a team. An unknown or old link lands on a page that
 * says so, never on the season.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/app/private-events/join/[token]">,
): Promise<Response> {
  const { token } = await params;
  const found = await seasonForInvite(db, token);
  const target = found
    ? `/app/seasons/${found.slug}/register`
    : "/app/private-events/join/expired";
  const response = NextResponse.redirect(new URL(target, request.url), 307);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (found)
    response.cookies.set(PRIVATE_INVITE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/app",
      maxAge: PRIVATE_INVITE_DAYS * 86_400,
    });
  return response;
}
