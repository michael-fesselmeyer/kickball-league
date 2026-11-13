import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { buildDigestsNow, drainOutboxNow } from "@/services/outbox";

/**
 * The digest job: gathers each person's held non-urgent messages whose
 * digest is due into one email, then sends what is due. Safe to run twice:
 * a held message goes into one digest only. Runs after 6 pm in the league's
 * time zone (vercel.json); a digest that falls in someone's quiet hours
 * waits for them to end. Vercel Cron calls it with `Authorization: Bearer
 * $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const now = new Date();
  const digests = await buildDigestsNow(now);
  const delivery = await drainOutboxNow(now);
  return Response.json({ digests, delivery });
}
