import { txDb } from "@/db/client";
import { removeExpiredInjuries } from "@/db/queries/injury";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";

/**
 * Daily job: removes the details of every injury report older than the
 * retention period (ADR 0064), whatever its league. Safe to run twice: a
 * report's details are removed once. Each removal is in the audit log with
 * no actor. Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const removed = await removeExpiredInjuries(txDb, new Date());
  return Response.json({ removed });
}
