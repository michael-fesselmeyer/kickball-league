import { txDb } from "@/db/client";
import { askForUnstaffedGames } from "@/db/queries/referee-cover";
import { allLeagues } from "@/db/queries/leagues";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job, late morning in the league's time zone: asks the league's
 * refs who are free about every game starting within a day that has no
 * ref (issue #389). Safe to run twice: each ask is queued once per game
 * and person until the game gains and loses a ref again.
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
  // Each league asks its own refs (ADR 0048).
  for (const league of leagues)
    queued += await txDb.transaction((tx) =>
      askForUnstaffedGames(tx, { leagueId: league.id, now }),
    );
  const delivery = queued > 0 ? await drainOutboxNow(now) : null;
  return Response.json({ queued, delivery });
}
