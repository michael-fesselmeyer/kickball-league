import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { RATE_LIMIT_KEEP_MS, SIGN_IN_LINKS_PER_INBOX } from "@/lib/auth/config";
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

/**
 * Counts one request against `key` and says whether it is within `max` for
 * the window that started with the key's first request, in one atomic
 * statement. The row's `last_request` holds when that window started, so
 * Better Auth's own sweep and `pruneRateLimits` drop it once it is over.
 */
export async function consumeRateLimit(
  db: Db,
  key: string,
  rule: { windowSeconds: number; max: number },
  now: Date,
): Promise<boolean> {
  const at = now.getTime();
  const windowStart = at - rule.windowSeconds * 1000;
  const expired = sql`${rateLimit.lastRequest} <= ${windowStart}`;
  const [row] = await db
    .insert(rateLimit)
    .values({ key, count: 1, lastRequest: at })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${at} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count });
  return (row?.count ?? Number.POSITIVE_INFINITY) <= rule.max;
}

/**
 * The counter for sign-in links to one inbox. The address is hashed, so
 * the table never holds an email address.
 */
export const signInLinkKey = (email: string) =>
  `sign-in-link:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;

/** Whether another sign-in link may go to this inbox now. */
export const allowSignInLink = (db: Db, email: string, now: Date) =>
  consumeRateLimit(db, signInLinkKey(email), SIGN_IN_LINKS_PER_INBOX, now);
