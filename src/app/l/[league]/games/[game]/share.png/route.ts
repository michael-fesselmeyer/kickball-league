import { db } from "@/db/client";
import { leagueBySegment } from "@/db/queries/leagues";
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
  ctx: RouteContext<"/l/[league]/games/[game]/share.png">,
) {
  const { league: segment, game } = await ctx.params;
  const id = parseId<GameId>(game);
  const league = await leagueBySegment(db, segment);
  const found = league && id ? await publishedGame(db, id) : null;
  if (!found || found.leagueId !== league?.id)
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
