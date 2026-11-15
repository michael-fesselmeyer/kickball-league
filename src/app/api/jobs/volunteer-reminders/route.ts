import { txDb } from "@/db/client";
import { allLeagues } from "@/db/queries/leagues";
import { queueVolunteerReminders } from "@/db/queries/volunteer";
import { localDay } from "@/domain/schedule/public-game";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: reminds everyone on a volunteer shift that starts tomorrow, in
 * each league's own time zone (ADR 0048). Safe to run twice: each reminder
 * is queued once.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const leagues = await allLeagues(txDb);
  if (leagues.length === 0) return Response.json({ skipped: "No league yet" });
  const now = new Date();
  let queued = 0;
  for (const league of leagues) {
    queued += await txDb.transaction((tx) =>
      queueVolunteerReminders(tx, {
        leagueId: league.id,
        today: localDay(now, league.timeZone),
        timeZone: league.timeZone,
      }),
    );
  }
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
