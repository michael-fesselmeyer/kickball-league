import { txDb } from "@/db/client";
import { closeOldItems } from "@/db/queries/lost-found";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: closes lost and found posts after 30 days, tells each poster
 * and anyone with an open answer, deletes posts closed for over 90 days,
 * then sends what is due (issue #385). Safe to run twice: each notice is
 * queued once. Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const closed = await txDb.transaction((tx) => closeOldItems(tx, now));
  const delivery = await drainOutboxNow(now);
  return Response.json({ closed, delivery });
}
