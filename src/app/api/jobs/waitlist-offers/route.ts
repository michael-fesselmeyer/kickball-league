import { txDb } from "@/db/client";
import { sendWaitlistOffers } from "@/db/queries/waitlist";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Waitlist offers: marks offers whose 48 hours ran out as expired and offers
 * each free team spot to the next captain in line. An offer stops holding
 * its spot the moment it runs out, so a late run only delays the next
 * offer. Safe to run twice. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const offers = await txDb.transaction((tx) => sendWaitlistOffers(tx, now));
  const delivery = await drainOutboxNow(now);
  return Response.json({ ...offers, delivery });
}
