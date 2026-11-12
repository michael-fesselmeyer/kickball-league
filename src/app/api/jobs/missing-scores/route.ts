import { txDb } from "@/db/client";
import { queueScoreReminders } from "@/db/queries/score-reminders";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Reminds the referee 30 minutes after a game with no score, and both
 * captains after 2 hours, then sends them. Safe to run as often as the
 * schedule allows: each reminder is queued once. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const now = new Date();
  const queued = await txDb.transaction((tx) => queueScoreReminders(tx, now));
  const delivery = await drainOutboxNow(now);
  return Response.json({ queued, delivery });
}
