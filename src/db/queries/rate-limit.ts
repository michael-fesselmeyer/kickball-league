import { lt } from "drizzle-orm";
import { RATE_LIMIT_KEEP_MS } from "@/lib/auth/config";
import { rateLimit } from "../schema/auth";
import type { Db } from "./schedule";

/**
 * Deletes rate-limit counters untouched for a day. Better Auth already drops
 * rows older than its longest window whenever a counter's window restarts;
 * this daily sweep catches the ones from clients that never came back, so
 * the table stays small. Returns how many it deleted.
 */
export async function pruneRateLimits(db: Db, now: Date): Promise<number> {
  const gone = await db
    .delete(rateLimit)
    .where(lt(rateLimit.lastRequest, now.getTime() - RATE_LIMIT_KEEP_MS))
    .returning({ id: rateLimit.id });
  return gone.length;
}
