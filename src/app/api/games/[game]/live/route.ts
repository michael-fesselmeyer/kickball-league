import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { liveGame, snapshotOf } from "@/db/queries/live-scores";
import { type GameId, parseId } from "@/domain/ids";
import type { LiveSnapshot } from "@/domain/scores/live";
import {
  gameTag,
  LIVE_SCORE_CDN_SECONDS,
  LIVE_SCORE_LIFE,
} from "@/lib/public-cache";

/**
 * A game's live score as JSON, polled by the public game page while the game
 * is on (docs/architecture.md, section 3, and ADR 0009). The server keeps it
 * for a few seconds and saving a half-inning expires it; a CDN may keep a
 * copy for a few seconds more, so a crowd of phones costs a query every few
 * seconds, not one per phone.
 */
async function snapshot(gameId: GameId): Promise<LiveSnapshot | null> {
  "use cache";
  cacheLife(LIVE_SCORE_LIFE);
  cacheTag(gameTag(gameId));
  const live = await liveGame(db, gameId);
  return live ? snapshotOf(live) : null;
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/games/[game]/live">,
) {
  const id = parseId<GameId>((await ctx.params).game);
  const found = id ? await snapshot(id) : null;
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
