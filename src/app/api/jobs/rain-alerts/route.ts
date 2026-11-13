import { txDb } from "@/db/client";
import {
  checkRain,
  gameDaysDue,
  queueRainAlerts,
} from "@/db/queries/rain-alerts";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { featureEnabled, refuseJobsWhileFrozen } from "@/lib/platform/site";
import { cachedForecast } from "@/lib/weather";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Daily job, in the evening: checks the forecast for game days starting in
 * the next 30 hours and alerts admins on "watch" or "likely", then sends
 * the alerts. The forecast is read before the transaction, so a slow
 * forecast service never holds one open. Safe to run twice: each admin gets
 * each level once per game day. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  if (!(await featureEnabled("weather")))
    return Response.json({ skipped: "Weather is switched off" });
  const now = new Date();
  const checks = await checkRain(await gameDaysDue(txDb, now), cachedForecast);
  const queued = await txDb.transaction((tx) =>
    queueRainAlerts(tx, checks, now),
  );
  const delivery = await drainOutboxNow(now);
  return Response.json({
    checked: checks.map((c) => ({
      season: c.day.seasonSlug,
      date: c.day.date,
      level: c.risk.covered > 0 ? c.risk.level : "no forecast",
      peakChance: c.risk.peakChance,
    })),
    queued,
    delivery,
  });
}
