import { txDb } from "@/db/client";
import { advanceCheckIns } from "@/db/queries/leadership";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: moves season-end leadership check-ins along (ADR 0077). Asks
 * newly suggested teammates in one batch, closes check-ins and ballots that
 * are due, ends a captain's private time with a result, and offers
 * captains-elect the captaincy once their next season starts. Paused
 * check-ins wait. Safe to run twice.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const counts = await txDb.transaction((tx) => advanceCheckIns(tx, now));
  const queued =
    counts.asked + counts.ballots + counts.closed + counts.results > 0;
  const delivery = queued ? await drainOutboxNow(now) : null;
  return Response.json({ ...counts, delivery });
}
