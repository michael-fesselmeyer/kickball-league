import { txDb } from "@/db/client";
import { queueStartReminders } from "@/db/queries/game-start";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job, in the evening: queues the start-on-time nudge (issue #467).
 * For each game tomorrow (league time) whose end of play, sunset or the
 * field time, leaves no room for a late start, its captains and ref will
 * hear when first pitch is and when play must end, two hours before it;
 * the outbox sweep through the day sends them then. Safe to run twice: each
 * person hears once per game. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const queued = await txDb.transaction((tx) => queueStartReminders(tx, now));
  const delivery = await drainOutboxNow(now);
  return Response.json({ queued, delivery });
}
