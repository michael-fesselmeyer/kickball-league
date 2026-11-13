import { txDb } from "@/db/client";
import { finalizeDueScores } from "@/db/queries/scores";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";

/**
 * Daily job: finalizes every score that has gone 24 hours without a dispute
 * (roadmap week 5). Vercel Cron calls it with `Authorization: Bearer
 * $CRON_SECRET`; anything else is refused.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const finalized = await txDb.transaction((tx) =>
    finalizeDueScores(tx, new Date()),
  );
  return Response.json({ finalized });
}
