import { txDb } from "@/db/client";
import { queuePaymentReminders } from "@/db/queries/payment-reminders";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: queues the 7-, 3- and 1-day payment reminders that are due,
 * then sends them. Safe to run twice: each reminder is queued once. Vercel
 * Cron calls it with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const queued = await txDb.transaction((tx) => queuePaymentReminders(tx, now));
  const delivery = await drainOutboxNow(now);
  return Response.json({ queued, delivery });
}
