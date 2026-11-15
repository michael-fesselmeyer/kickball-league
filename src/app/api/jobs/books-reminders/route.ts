import { txDb } from "@/db/client";
import { queueBooksReminders } from "@/db/queries/books";
import { queuePermitAlerts } from "@/db/queries/permit-plan";
import { currentLeague } from "@/db/queries/seasons";
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
 * 0051). Safe to run twice: each message is queued once.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const league = await currentLeague(txDb);
  if (!league) return Response.json({ skipped: "No league yet" });
  const now = new Date();
  const today = localDate(now, league.timeZone);
  const queued = await txDb.transaction(
    async (tx) =>
      (await queueBooksReminders(tx, league.id, today, now)) +
      (await queuePermitAlerts(tx, league.id, now)),
  );
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
