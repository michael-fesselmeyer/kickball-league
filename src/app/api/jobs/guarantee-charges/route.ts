import { env } from "@/env";
import { runGuaranteeCharges } from "@/lib/guarantee-charges";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: the captain guarantee. Warns captains 72 hours before the
 * payment deadline, then charges their saved card for the team's unpaid
 * balance. Safe to run twice: a warning is sent once per deadline and a
 * team is charged once. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const run = await runGuaranteeCharges(now);
  const delivery = await drainOutboxNow(now);
  return Response.json({ ...run, delivery });
}
