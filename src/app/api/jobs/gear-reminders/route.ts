import { txDb } from "@/db/client";
import { queueGearReminders } from "@/db/queries/equipment";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job, in the evening: reminds everyone bringing a league kit to a
 * game tomorrow which kit, where to get it and where it goes (issue #286),
 * then sends what is due. Safe to run twice: each assignment is reminded
 * once per game day. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const queued = await txDb.transaction((tx) => queueGearReminders(tx, now));
  const delivery = await drainOutboxNow(now);
  return Response.json({ queued, delivery });
}
