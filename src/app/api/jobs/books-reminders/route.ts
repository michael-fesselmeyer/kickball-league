import { txDb } from "@/db/client";
import { queueBooksReminders } from "@/db/queries/books";
import { currentLeague } from "@/db/queries/seasons";
import { localDate } from "@/domain/books/ledger-csv";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: emails the owners 30 and 7 days before a permit application
 * window opens, a permit renews or the insurance certificate expires
 * (ADR 0034). Safe to run twice: each reminder is queued once.
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
  const queued = await txDb.transaction((tx) =>
    queueBooksReminders(tx, league.id, today, now),
  );
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
