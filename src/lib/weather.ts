import { cacheLife } from "next/cache";
import { db } from "@/db/client";
import { nextGameDayStart } from "@/db/queries/demo";
import { defaultLeague } from "@/db/queries/leagues";
import type {
  GridHour,
  Observation,
  WeatherAlert,
} from "@/domain/weather/decision";
import type { ForecastHour } from "@/domain/weather/forecast";
import { env } from "@/env";
import { demoStatus } from "@/lib/demo/guard";
import { siteOrigin } from "@/lib/site";
import {
  type NwsOptions,
  nwsAlerts,
  nwsGrid,
  nwsHourly,
  nwsObservations,
  nwsPointLinks,
  nwsStations,
  type PointLinks,
  roundCoordinate,
  type Station,
} from "@/services/weather";
import {
  FIXTURE_ALERTS,
  FIXTURE_STATION,
  fixtureForecast,
  fixtureGrid,
  fixtureObservations,
  usesWeatherFixture,
} from "@/services/weather-fixture";

/**
 * The forecast as pages and jobs read it: through the data cache, so most
 * views are served from memory and a stale forecast is refreshed in the
 * background (docs/architecture.md, sections 7 and 8). A failure throws
 * inside the cached function so it is not stored, and comes out here as
 * null: no forecast, never an error page. Each answer carries when NWS
 * gave it, so the rain-out card can say how old its numbers are.
 *
 * The local demo reads a recorded pattern instead (docs/demo.md): showers
 * over the next game day and a dry night before it, for every place.
 */

const options = (): NwsOptions => ({
  userAgent: `kickball-league (${siteOrigin(env.BETTER_AUTH_URL)})`,
});

const demo = () => usesWeatherFixture(process.env, demoStatus(process.env).on);

/** An answer and when NWS gave it. */
export type Fetched<T> = { value: T; fetchedAt: Date };

const stamped = <T>(value: T): Fetched<T> => ({ value, fetchedAt: new Date() });

async function pointLinksFor(lat: number, lng: number): Promise<PointLinks> {
  "use cache";
  // A place's forecast grid square only moves when the forecast office
  // redraws its grid.
  cacheLife("weeks");
  const found = await nwsPointLinks(lat, lng, options());
  if (!found.ok) throw new Error(found.error);
  return found.value;
}

async function hourlyAt(url: string): Promise<Fetched<ForecastHour[]>> {
  "use cache";
  // The forecast is updated about hourly. Served from cache for an hour,
  // then refreshed in the background on the next read.
  cacheLife("hours");
  const found = await nwsHourly(url, options());
  if (!found.ok) throw new Error(found.error);
  return stamped(found.value);
}

async function gridAt(url: string): Promise<Fetched<GridHour[]>> {
  "use cache";
  cacheLife("hours");
  const found = await nwsGrid(url, options());
  if (!found.ok) throw new Error(found.error);
  return stamped(found.value);
}

async function stationsAt(url: string): Promise<Station[]> {
  "use cache";
  // The stations near a grid square rarely change.
  cacheLife("weeks");
  const found = await nwsStations(url, options());
  if (!found.ok) throw new Error(found.error);
  return found.value;
}

/** Two days of a station's reports up to the hour named. */
async function observationsAt(
  stationId: string,
  hour: string,
): Promise<Fetched<Observation[]>> {
  "use cache";
  // Stations report hourly; a new hour is a new entry.
  cacheLife({ stale: 300, revalidate: 900, expire: 3 * 3600 });
  const since = new Date(new Date(hour).getTime() - 49 * 3_600_000);
  const found = await nwsObservations(stationId, since, options());
  if (!found.ok) throw new Error(found.error);
  return stamped(found.value);
}

async function alertsAt(
  lat: number,
  lng: number,
): Promise<Fetched<WeatherAlert[]>> {
  "use cache";
  // Warnings are short-lived: at most a few minutes old.
  cacheLife("minutes");
  const found = await nwsAlerts(lat, lng, options());
  if (!found.ok) throw new Error(found.error);
  return stamped(found.value);
}

/**
 * The local demo's week of weather (docs/demo.md): showers over the next
 * game day, the same for every place, kept for a few minutes.
 */
async function demoHourly(): Promise<Fetched<ForecastHour[]>> {
  "use cache";
  cacheLife("minutes");
  const now = new Date();
  // Showers over the default league's next game day (ADR 0048).
  const league = await defaultLeague(db);
  return stamped(
    fixtureForecast(
      now,
      league ? await nextGameDayStart(db, league.id, now) : null,
    ),
  );
}

const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

const point = (lat: number, lng: number) =>
  [roundCoordinate(lat), roundCoordinate(lng)] as const;

/** The hourly forecast for a place, or null when it cannot be had right now. */
export async function cachedForecast(
  lat: number,
  lng: number,
): Promise<ForecastHour[] | null> {
  const found = await cachedHourly(lat, lng);
  return found?.value ?? null;
}

export async function cachedHourly(
  lat: number,
  lng: number,
): Promise<Fetched<ForecastHour[]> | null> {
  if (demo()) return orNull(demoHourly);
  return orNull(async () =>
    hourlyAt((await pointLinksFor(...point(lat, lng))).hourly),
  );
}

export async function cachedGrid(
  lat: number,
  lng: number,
): Promise<Fetched<GridHour[]> | null> {
  if (demo())
    return orNull(async () => {
      const hourly = await demoHourly();
      return { ...hourly, value: fixtureGrid(hourly.value) };
    });
  return orNull(async () =>
    gridAt((await pointLinksFor(...point(lat, lng))).grid),
  );
}

export type StationReports = {
  station: Station;
  reports: Fetched<Observation[]>;
};

/**
 * The nearest station's last two days of reports. When the nearest one
 * does not answer, the next nearest, up to three.
 */
export async function cachedReports(
  lat: number,
  lng: number,
  now: Date,
): Promise<StationReports | null> {
  if (demo())
    return {
      station: FIXTURE_STATION,
      reports: stamped(fixtureObservations(now)),
    };
  const stations = await orNull(async () =>
    stationsAt((await pointLinksFor(...point(lat, lng))).stations),
  );
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  for (const station of (stations ?? []).slice(0, 3)) {
    const reports = await orNull(() =>
      observationsAt(station.id, hour.toISOString()),
    );
    if (reports && reports.value.length > 0) return { station, reports };
  }
  return null;
}

export async function cachedAlerts(
  lat: number,
  lng: number,
): Promise<Fetched<WeatherAlert[]> | null> {
  if (demo()) return stamped([...FIXTURE_ALERTS]);
  return orNull(() => alertsAt(...point(lat, lng)));
}
