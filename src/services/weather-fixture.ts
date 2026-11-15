import type {
  GridHour,
  Observation,
  WeatherAlert,
} from "@/domain/weather/decision";
import type { ForecastHour } from "@/domain/weather/forecast";
import type { Station } from "./weather";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether forecasts come from the recorded demo pattern instead of the
 * National Weather Service, so the local demo needs no network
 * (docs/demo.md). Only when WEATHER_FIXTURE is "true" and the server is not
 * a production build outside the demo, so the league's site can never show
 * an invented forecast.
 */
export function usesWeatherFixture(env: Env, demoOn: boolean): boolean {
  if (env.WEATHER_FIXTURE !== "true") return false;
  return env.NODE_ENV !== "production" || demoOn;
}

const HOUR = 3_600_000;
/** About as far ahead as the National Weather Service's hourly forecast. */
const HOURS = 156;
/** The rain moves in a little before the first game and lingers after. */
const RAIN_BEFORE = 2 * HOUR;
const RAIN_AFTER = 5 * HOUR;
/** Enough to put the day on watch (40%), short of likely (70%). */
export const FIXTURE_RAIN_CHANCE = 55;

/**
 * A plausible week of hourly weather from the current hour on: mild and
 * mostly dry, with showers around `rainAround` (the next game day's first
 * game), so the demo has a rain watch to show. The same for any time within
 * an hour, so a page and a job agree.
 */
export function fixtureForecast(
  now: Date,
  rainAround: Date | null,
): ForecastHour[] {
  const start = Math.floor(now.getTime() / HOUR) * HOUR;
  const hours: ForecastHour[] = [];
  for (let i = 0; i < HOURS; i++) {
    const at = start + i * HOUR;
    const startsAt = new Date(at);
    const raining =
      rainAround !== null &&
      at >= rainAround.getTime() - RAIN_BEFORE &&
      at < rainAround.getTime() + RAIN_AFTER;
    // Warmest mid-afternoon in New York (19:00 UTC), coolest before dawn.
    const warmth = Math.cos(((startsAt.getUTCHours() - 19) / 24) * 2 * Math.PI);
    hours.push({
      startsAt,
      endsAt: new Date(at + HOUR),
      temperatureF: Math.round(58 + 9 * warmth),
      precipChance: raining ? FIXTURE_RAIN_CHANCE : 5 + ((at / HOUR) % 11),
      summary: raining
        ? "Chance Showers"
        : warmth > 0
          ? "Mostly Sunny"
          : "Partly Cloudy",
    });
  }
  return hours;
}

/*
 * The rest of the rain-out decision card's weather (ADR 0057), from the
 * same pattern, so the demo's card agrees with its forecast: light rain in
 * the showery hours, a dry night at the nearest station, no alerts.
 */

/** Rain expected in a showery hour, in inches. */
export const FIXTURE_SHOWER_IN = 0.04;

/** The grid's rainfall for the recorded week: light rain while it showers. */
export function fixtureGrid(hours: readonly ForecastHour[]): GridHour[] {
  return hours.map((h) => ({
    startsAt: h.startsAt,
    rainIn: h.precipChance >= FIXTURE_RAIN_CHANCE ? FIXTURE_SHOWER_IN : 0,
    thunderChance: null,
  }));
}

/** The demo's nearest station, as NWS names the one in Central Park. */
export const FIXTURE_STATION: Station = {
  id: "KNYC",
  name: "New York City, Central Park",
};

/** Two days of routine reports at :51 with no rain: a dry night. */
export function fixtureObservations(now: Date): Observation[] {
  const last =
    Math.floor((now.getTime() - 51 * 60_000) / HOUR) * HOUR + 51 * 60_000;
  return Array.from({ length: 48 }, (_, i) => ({
    at: new Date(last - i * HOUR),
    lastHourMm: null,
  }));
}

/** No alerts in effect. */
export const FIXTURE_ALERTS: readonly WeatherAlert[] = [];
