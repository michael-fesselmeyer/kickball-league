import { db } from "@/db/client";
import { publishedGame } from "@/db/queries/public-schedule";
import { type GameId, parseId } from "@/domain/ids";
import { cardVersion, gameCard } from "@/domain/share/cards";
import { LONG_CACHE, renderShareImage, SHORT_CACHE } from "@/lib/share/image";

/**
 * A game's share image. The game page links it with `?v=<version>`; while that
 * version is current the image is cached for good, so it is drawn once per
 * change of score, status, time or place.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/games/[game]/share.png">,
) {
  const id = parseId<GameId>((await ctx.params).game);
  const found = id ? await publishedGame(db, id) : null;
  if (!found)
    return new Response("No game here.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const card = gameCard(found.game, found.timeZone);
  const asked = new URL(request.url).searchParams.get("v");
  return renderShareImage(card, {
    cacheControl: asked === cardVersion(card) ? LONG_CACHE : SHORT_CACHE,
  });
}
