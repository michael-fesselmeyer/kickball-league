import { txDb } from "@/db/client";
import { queueActingAdminNotices } from "@/db/queries/acting-admin";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Tells the acting admin and the owners when a handover has started or
 * ended (issue #468). Access itself follows the dates and needs no job; this
 * only sends the notices. Safe to run twice: each notice is queued once.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const queued = await txDb.transaction((tx) =>
    queueActingAdminNotices(tx, now),
  );
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
