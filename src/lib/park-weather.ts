import {
  lastWeather,
  placeKey,
  saveWeather,
  type WeatherData,
  type WeatherPart,
} from "@/db/queries/weather-snapshots";
import type { Db } from "@/db/queries/schedule";
import {
  type Decision,
  decide,
  rainFallen,
  type WeatherAlert,
} from "@/domain/weather/decision";
import type { Window } from "@/domain/weather/forecast";
import {
  cachedAlerts,
  cachedGrid,
  cachedHourly,
  cachedReports,
  type Fetched,
} from "@/lib/weather";

/**
 * A park's weather for the rain-out decision (ADR 0057): the forecast, the
 * nearest station's reports and the active alerts, each read fresh through
 * the data cache and saved, or, when NWS does not answer, the last saved
 * answer with when it was fetched. Never throws: a part nobody has seen
 * yet is null.
 */

export type Reading<T> = { value: T; fetchedAt: Date; live: boolean };

export type ParkWeather = {
  forecast: Reading<WeatherData<"forecast">> | null;
  observed: Reading<WeatherData<"observed">> | null;
  alerts: Reading<WeatherAlert[]> | null;
  /** NWS did not answer for at least one part just now. */
  down: boolean;
};

async function part<P extends WeatherPart>(
  db: Db,
  place: string,
  name: P,
  live: Fetched<WeatherData<P>> | null,
): Promise<Reading<WeatherData<P>> | null> {
  try {
    if (live) {
      await saveWeather(db, place, name, live.value, live.fetchedAt);
      return { ...live, live: true };
    }
    const last = await lastWeather(db, place, name);
    return last ? { ...last, live: false } : null;
  } catch {
    // The saved copy is a convenience; a database hiccup never hides the
    // fresh answer.
    return live ? { ...live, live: true } : null;
  }
}

export async function parkWeather(
  db: Db,
  lat: number,
  lng: number,
  now: Date,
): Promise<ParkWeather> {
  const [hourly, grid, reports, alerts] = await Promise.all([
    cachedHourly(lat, lng),
    cachedGrid(lat, lng),
    cachedReports(lat, lng, now),
    cachedAlerts(lat, lng),
  ]);
  const place = placeKey(lat, lng);
  const [forecast, observed, active] = await Promise.all([
    part(
      db,
      place,
      "forecast",
      hourly
        ? {
            value: { hourly: hourly.value, grid: grid?.value ?? null },
            fetchedAt: hourly.fetchedAt,
          }
        : null,
    ),
    part(
      db,
      place,
      "observed",
      reports
        ? {
            value: {
              station: reports.station,
              reports: reports.reports.value,
            },
            fetchedAt: reports.reports.fetchedAt,
          }
        : null,
    ),
    part(db, place, "alerts", alerts),
  ]);
  return {
    forecast,
    observed,
    alerts: active,
    down: !hourly || !grid || !reports || !alerts,
  };
}

/** The decision for one park's games from what its weather reading holds. */
export function parkDecision(
  weather: ParkWeather,
  games: readonly Window[],
  now: Date,
  timeZone: string,
): Decision {
  const observed = weather.observed;
  // Rain is counted back from when the reports were fetched, so a saved
  // copy never stretches over hours nobody measured.
  const asOf = observed && !observed.live ? observed.fetchedAt : now;
  return decide({
    hourly: weather.forecast?.value.hourly ?? null,
    grid: weather.forecast?.value.grid ?? null,
    observed: observed
      ? {
          stationId: observed.value.station.id,
          stationName: observed.value.station.name,
          last24: rainFallen(observed.value.reports, asOf, 24),
          last48: rainFallen(observed.value.reports, asOf, 48),
        }
      : null,
    // A saved alert that has since ended no longer bears on the call.
    alerts:
      weather.alerts?.value.filter(
        (a) => a.endsAt === null || a.endsAt > now,
      ) ?? null,
    games,
    now,
    timeZone,
  });
}
