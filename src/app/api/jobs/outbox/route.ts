import { revalidateTag } from "next/cache";
import { db } from "@/db/client";
import { eventTag } from "@/lib/public-cache";
import { purgeConcernEmails } from "@/db/queries/concerns";
import { purgeInterestEmails } from "@/db/queries/interest";
import { pruneRateLimits } from "@/db/queries/rate-limit";
import { purgeGuestData } from "@/db/queries/tournaments";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * The outbox sweep: sends queued messages that are due, retries failures
 * whose backoff has passed, and picks up claims a stopped worker left
 * behind. It also sweeps sign-in rate-limit counters untouched for a day,
 * and deletes guest teams' contact details and waiver signatures once a
 * tournament's retention days have passed.
 * Safe to run twice or alongside an immediate send. Vercel Cron
 * calls it with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const prunedRateLimits = await pruneRateLimits(db, new Date());
  const purgedConcernEmails = await purgeConcernEmails(db, new Date());
  const purgedInterestEmails = await purgeInterestEmails(db, new Date());
  const purgedSlugs = await purgeGuestData(db, new Date());
  // The event pages list guest teams' names: refresh them in the background.
  for (const slug of purgedSlugs) revalidateTag(eventTag(slug), "max");
  const purgedGuestData = purgedSlugs.length;
  const result = await drainOutboxNow();
  if (!result)
    return Response.json(
      {
        error: "Neither email nor push is configured; messages stay queued",
        prunedRateLimits,
        purgedGuestData,
      },
      { status: 503 },
    );
  return Response.json({
    ...result,
    prunedRateLimits,
    purgedConcernEmails,
    purgedInterestEmails,
    purgedGuestData,
  });
}
