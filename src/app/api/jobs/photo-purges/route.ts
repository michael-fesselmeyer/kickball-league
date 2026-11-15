import { txDb } from "@/db/client";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { retryFailedPurges } from "@/lib/media/optimizer-purge";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";

/**
 * Daily job: tries again every purge of a taken-down photo's cached copies
 * that failed (ADR 0069), whatever its league. Each failure and each retry
 * that gets through is in that league's audit log with no actor. Safe to
 * run twice: a cleared failure is not tried again. Off Vercel there is
 * nothing to purge. Vercel Cron calls it with `Authorization: Bearer
 * $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  return Response.json(await retryFailedPurges(txDb, new Date()));
}
