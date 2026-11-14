import { type GameId, parseId } from "@/domain/ids";
import { cachedLiveSnapshot } from "@/lib/game-cache";
import { LIVE_SCORE_CDN_SECONDS } from "@/lib/public-cache";

/**
 * A game's live score as JSON, polled by the public game page while the game
 * is on (docs/architecture.md, section 3, and ADR 0011). The server keeps it
 * for a few seconds, shared with the game page, and saving a half-inning
 * expires it; a CDN may keep a copy for a few seconds more, so a crowd of
 * phones costs a query every few seconds, not one per phone.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/games/[game]/live">,
) {
  const id = parseId<GameId>((await ctx.params).game);
  const found = id ? await cachedLiveSnapshot(id) : null;
  if (!found)
    return Response.json(
      { error: "No game with that id." },
      { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } },
    );
  return Response.json(found, {
    headers: {
      // Browsers ask again every time; a CDN answers for a few seconds.
      "Cache-Control": `public, max-age=0, s-maxage=${LIVE_SCORE_CDN_SECONDS}, stale-while-revalidate=${LIVE_SCORE_CDN_SECONDS}`,
    },
  });
}
