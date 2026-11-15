import { txDb } from "@/db/client";
import { queueBooksReminders } from "@/db/queries/books";
import { queueBooksNudge } from "@/db/queries/books-upkeep";
import { allLeagues } from "@/db/queries/leagues";
import { queuePermitAlerts } from "@/db/queries/permit-plan";
import { localDate } from "@/domain/books/ledger-csv";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: emails the owners 30 and 7 days before a permit application
 * window opens, a permit renews, the insurance certificate expires or a
 * season's permit fees are due (ADR 0034). It also alerts them once when a
 * season nears or passes NYC Parks' 50-hour insurance line, and once for
 * each window of field time coming up that the league won't use (ADR
 * 0055). In a month's first week it queues the owners' nudge about expected
 * costs and missing receipts (ADR 0059). Safe to run twice: each message is
 * queued once.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const leagues = await allLeagues(txDb);
  if (leagues.length === 0) return Response.json({ skipped: "No league yet" });
  const now = new Date();
  // Every league's owners, each on their own league's calendar (ADR 0048).
  let queued = 0;
  for (const league of leagues) {
    const today = localDate(now, league.timeZone);
    queued += await txDb.transaction(
      async (tx) =>
        (await queueBooksReminders(tx, league.id, today, now)) +
        (await queuePermitAlerts(tx, league.id, now)) +
        (await queueBooksNudge(tx, {
          leagueId: league.id,
          timeZone: league.timeZone,
          today,
          now,
        })),
    );
  }
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
