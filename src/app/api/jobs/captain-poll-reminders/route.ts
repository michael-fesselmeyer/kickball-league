import { txDb } from "@/db/client";
import { queueReminders } from "@/db/queries/captain-polls";
import { allLeagues } from "@/db/queries/leagues";
import { localDate } from "@/domain/books/ledger-csv";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: reminds the captains of teams that have not voted in a quick
 * poll closing within a day (ADR 0063), in each league's own time zone.
 * Safe to run twice: a captain gets one reminder a day per poll.
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
      queueReminders(tx, {
        leagueId: league.id,
        now,
        today: localDate(now, league.timeZone),
      }),
    );
  }
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
