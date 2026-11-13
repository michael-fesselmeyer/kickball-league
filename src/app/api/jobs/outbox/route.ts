import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * The outbox sweep: sends queued messages that are due, retries failures
 * whose backoff has passed, and picks up claims a stopped worker left
 * behind. Safe to run twice or alongside an immediate send. Vercel Cron
 * calls it with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const result = await drainOutboxNow();
  if (!result)
    return Response.json(
      { error: "Neither email nor push is configured; messages stay queued" },
      { status: 503 },
    );
  return Response.json(result);
}
