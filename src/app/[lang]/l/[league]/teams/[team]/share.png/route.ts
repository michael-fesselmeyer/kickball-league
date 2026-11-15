import { db } from "@/db/client";
import { leagueBySegment } from "@/db/queries/leagues";
import { teamShare } from "@/db/queries/team-share";
import { cardVersion } from "@/domain/share/cards";
import { LONG_CACHE, renderShareImage, SHORT_CACHE } from "@/lib/share/image";

/** A team's share image, cached for good while its `?v=` version is current. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/l/[league]/teams/[team]/share.png">,
) {
  const { league: segment, team } = await ctx.params;
  const league = await leagueBySegment(db, segment);
  const found = league ? await teamShare(db, league.id, team) : null;
  if (!found)
    return new Response("No team with that name.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const asked = new URL(request.url).searchParams.get("v");
  return renderShareImage(found.card, {
    cacheControl: asked === cardVersion(found.card) ? LONG_CACHE : SHORT_CACHE,
  });
}
