import { cookies } from "next/headers";
import { db } from "@/db/client";
import { leagueBySlug } from "@/db/queries/leagues";
import { isLeagueSlug } from "@/domain/league/paths";
import { LEAGUE_COOKIE, LEAGUE_COOKIE_MAX_AGE } from "@/lib/league/active";
import { safeNextPath } from "@/lib/safe-next";

/**
 * The league switcher, and the way in from a league's public pages: shows
 * that league in the app, then goes on to `next` (an app path; anything
 * else goes to the app's home). Changes nothing but which league the app
 * shows, so it needs no permission; what the person may do there is checked
 * against their role in that league.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/[lang]/app/league/[league]">,
): Promise<Response> {
  const { league: slug } = await params;
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const found = isLeagueSlug(slug) ? await leagueBySlug(db, slug) : null;
  if (!found) return new Response("Not found", { status: 404 });
  (await cookies()).set(LEAGUE_COOKIE, found.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: LEAGUE_COOKIE_MAX_AGE,
  });
  return Response.redirect(new URL(next, url), 303);
}
