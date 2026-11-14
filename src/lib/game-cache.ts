import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { liveGame, snapshotOf } from "@/db/queries/live-scores";
import {
  publishedGame,
  publishedGamesBetween,
  publishedSchedule,
} from "@/db/queries/public-schedule";
import type { GameId, SeasonId } from "@/domain/ids";
import type { LiveSnapshot } from "@/domain/scores/live";
import {
  gameTag,
  LIVE_SCORE_LIFE,
  PUBLIC_PAGE_LIFE,
  seasonTag,
  teamTag,
} from "./public-cache";

/**
 * A game's live score, kept a few seconds. The public game page and the live
 * score poll share it, so a crowd opening the page while phones poll costs a
 * query every few seconds, not one per visit (docs/architecture.md,
 * section 3). Saving a half-inning or a score expires it through `gameTag`.
 */
export async function cachedLiveSnapshot(
  gameId: GameId,
): Promise<LiveSnapshot | null> {
  "use cache";
  cacheLife(LIVE_SCORE_LIFE);
  cacheTag(gameTag(gameId));
  const live = await liveGame(db, gameId);
  return live ? snapshotOf(live) : null;
}

/**
 * The live score as the game page's HTML shows it. Kept like the page's
 * other reads, so the page stays static, and expired with the page by every
 * live-scoring change (`refreshGamePage`); while the game is on, the page's
 * LiveScore keeps it current by polling `cachedLiveSnapshot` through the
 * live route.
 */
export async function cachedPageSnapshot(
  gameId: GameId,
): Promise<LiveSnapshot | null> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(gameTag(gameId));
  const live = await liveGame(db, gameId);
  return live ? snapshotOf(live) : null;
}

/**
 * A published game for its public page, cached like the season's other
 * public pages: tagged with its season, which publishing a schedule (a
 * rain-out included) and reporting or answering a score expire, and with
 * the game, which entering a half-inning expires. The page and its metadata
 * share one read.
 */
export async function cachedPublishedGame(gameId: GameId) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(gameTag(gameId));
  const found = await publishedGame(db, gameId);
  if (found) cacheTag(seasonTag(found.game.seasonId));
  return found;
}

/** A season's published schedule, for the game page's stats. */
export async function cachedSeasonSchedule(seasonId: SeasonId) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(seasonTag(seasonId));
  return publishedSchedule(db, seasonId);
}

/**
 * Every published meeting of two teams, across seasons, for the game page's
 * head-to-head history: tagged with both teams and every season it covers.
 */
export async function cachedMeetings(slugA: string, slugB: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(teamTag(slugA), teamTag(slugB));
  const games = await publishedGamesBetween(db, slugA, slugB);
  for (const id of new Set(games.map((g) => g.seasonId)))
    cacheTag(seasonTag(id));
  return games;
}
