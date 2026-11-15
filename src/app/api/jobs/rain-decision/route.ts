import { txDb } from "@/db/client";
import {
  type DecisionCheck,
  gameDaysForDecision,
  queueDecisionAlerts,
  worstPark,
} from "@/db/queries/rainout-decision";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { parkDecision, parkWeather } from "@/lib/park-weather";
import { featureEnabled, refuseJobsWhileFrozen } from "@/lib/platform/site";
import { drainOutboxNow } from "@/services/outbox";

/**
 * The decision-time alert (ADR 0057), twice a day at fixed hours
 * (vercel.json): for each game day whose first pitch is 2 to 8 hours away,
 * reads each park's weather (the forecast, the rain already fallen at the
 * nearest station, active alerts) and, on "watch" or "likely", alerts
 * everyone who confirms rain-outs with the decision card's summary and a
 * link to the rain-out screen. Once per game day; it never cancels
 * anything. The weather is read before the transaction, so a slow NWS
 * never holds one open. Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  if (!(await featureEnabled("weather")))
    return Response.json({ skipped: "Weather is switched off" });
  // Every league's game days; each alert goes to that league's people.
  const now = new Date();

  const checks: DecisionCheck[] = [];
  for (const day of await gameDaysForDecision(txDb, now)) {
    const parks = new Map<string, typeof day.games>();
    for (const g of day.games) {
      const key = `${g.lat},${g.lng}`;
      parks.set(key, [...(parks.get(key) ?? []), g]);
    }
    const decisions = await Promise.all(
      [...parks.values()].map(async (games) => {
        const [first] = games;
        if (!first) return null;
        const weather = await parkWeather(txDb, first.lat, first.lng, now);
        return {
          park: first.venue,
          decision: parkDecision(weather, games, now, day.timeZone),
        };
      }),
    );
    const worst = worstPark(decisions.filter((d) => d !== null));
    if (worst) checks.push({ day, ...worst, parks: parks.size });
  }

  const queued = await txDb.transaction((tx) =>
    queueDecisionAlerts(tx, checks, now),
  );
  const delivery = await drainOutboxNow(now);
  return Response.json({
    checked: checks.map((c) => ({
      season: c.day.seasonSlug,
      date: c.day.date,
      level: c.decision.blind ? "no weather" : c.decision.level,
      summary: c.decision.summary,
    })),
    queued,
    delivery,
  });
}
