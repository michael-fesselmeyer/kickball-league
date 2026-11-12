import { db } from "@/db/client";
import { teamShare } from "@/db/queries/team-share";
import { cardVersion } from "@/domain/share/cards";
import { LONG_CACHE, renderShareImage, SHORT_CACHE } from "@/lib/share/image";

/** A team's share image, cached for good while its `?v=` version is current. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/teams/[team]/share.png">,
) {
  const found = await teamShare(db, (await ctx.params).team);
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
