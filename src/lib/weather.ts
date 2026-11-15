import { cacheLife } from "next/cache";
import { db } from "@/db/client";
import { nextGameDayStart } from "@/db/queries/demo";
import type { ForecastHour } from "@/domain/weather/forecast";
import { env } from "@/env";
import { demoStatus } from "@/lib/demo/guard";
import { siteOrigin } from "@/lib/site";
import {
  type NwsOptions,
  nwsHourly,
  nwsHourlyUrl,
  roundCoordinate,
} from "@/services/weather";
import {
  fixtureForecast,
  usesWeatherFixture,
} from "@/services/weather-fixture";

/**
 * The forecast as pages and jobs read it: through the data cache, so most
 * views are served from memory and a stale forecast is refreshed in the
 * background (docs/architecture.md, sections 7 and 8). A failure throws
 * inside the cached function so it is not stored, and comes out here as
 * null: no forecast, never an error page.
 */

const options = (): NwsOptions => ({
  userAgent: `kickball-league (${siteOrigin(env.BETTER_AUTH_URL)})`,
});

async function hourlyUrlFor(lat: number, lng: number): Promise<string> {
  "use cache";
  // A place's forecast grid square only moves when the forecast office
  // redraws its grid.
  cacheLife("weeks");
  const found = await nwsHourlyUrl(lat, lng, options());
  if (!found.ok) throw new Error(found.error);
  return found.value;
}

async function hourlyAt(url: string): Promise<ForecastHour[]> {
  "use cache";
  // The forecast is updated about hourly. Served from cache for an hour,
  // then refreshed in the background on the next read.
  cacheLife("hours");
  const found = await nwsHourly(url, options());
  if (!found.ok) throw new Error(found.error);
  return found.value;
}

/**
 * The local demo's week of weather (docs/demo.md): showers over the next
 * game day, the same for every place, kept for a few minutes.
 */
async function demoHourly(): Promise<ForecastHour[]> {
  "use cache";
  cacheLife("minutes");
  const now = new Date();
  return fixtureForecast(now, await nextGameDayStart(db, now));
}

/** The hourly forecast for a place, or null when it cannot be had right now. */
export async function cachedForecast(
  lat: number,
  lng: number,
): Promise<ForecastHour[] | null> {
  try {
    if (usesWeatherFixture(process.env, demoStatus(process.env).on))
      return await demoHourly();
    const url = await hourlyUrlFor(roundCoordinate(lat), roundCoordinate(lng));
    return await hourlyAt(url);
  } catch {
    return null;
  }
}
