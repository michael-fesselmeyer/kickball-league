import { txDb } from "@/db/client";
import { queueChecklistReminders } from "@/db/queries/checklist";
import { currentLeague } from "@/db/queries/seasons";
import { localDate } from "@/domain/books/ledger-csv";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job: reminds each season checklist task's owner a few days before
 * it is due and once when it is overdue (ADR 0061). Safe to run twice:
 * each reminder is queued once.
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
    queueChecklistReminders(tx, { leagueId: league.id, today }),
  );
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
