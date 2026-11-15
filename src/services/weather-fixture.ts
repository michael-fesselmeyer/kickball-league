<<<<<<< HEAD
import type { ForecastHour } from "@/domain/weather/forecast";
=======
import pointFixture from "./fixtures/nws-points.json";
import stationsFixture from "./fixtures/nws-stations.json";
import { NWS_ORIGIN, type WeatherFetch } from "./weather";
>>>>>>> 33a274e5 (feat(weather): read rainfall, nearby gauges and alerts from NWS into a rain-out decision)

type Env = Readonly<Record<string, string | undefined>>;

/**
<<<<<<< HEAD
 * Whether forecasts come from the recorded demo pattern instead of the
 * National Weather Service, so the local demo needs no network
 * (docs/demo.md). Only when WEATHER_FIXTURE is "true" and the server is not
 * a production build outside the demo, so the league's site can never show
 * an invented forecast.
=======
 * The National Weather Service played back for development, the demo and
 * the end-to-end flows, which must never reach the network. The answers
 * have the real API's shape and are built around the current time: a wet
 * night (about 0.6 in at the nearest station, ending eight hours ago) and
 * thunderstorms from 5 to 10 pm league time, so the rain-out decision card
 * has something to say on any day.
 */

/**
 * Whether forecasts come from the playback instead of NWS. Only when
 * WEATHER_FIXTURE is "true" and the server is not a production build
 * outside the demo, so the league's own site always shows the real
 * weather.
>>>>>>> 33a274e5 (feat(weather): read rainfall, nearby gauges and alerts from NWS into a rain-out decision)
 */
export function usesWeatherFixture(env: Env, demoOn: boolean): boolean {
  if (env.WEATHER_FIXTURE !== "true") return false;
  return env.NODE_ENV !== "production" || demoOn;
}

<<<<<<< HEAD
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
=======
const HOUR_MS = 3_600_000;
const TIME_ZONE = "America/New_York";

const localHour = (instant: Date): number =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hour: "numeric",
      hourCycle: "h23",
    }).format(instant),
  );

/** Thunderstorms from 5 to 10 pm, a dry day otherwise. */
const stormy = (instant: Date) => {
  const hour = localHour(instant);
  return hour >= 17 && hour < 22;
};

const iso = (instant: Date) => instant.toISOString().replace(".000Z", "+00:00");

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

/** The next 72 hours, starting at the top of the current hour. */
function hoursFrom(now: Date): Date[] {
  const start = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return Array.from({ length: 72 }, (_, i) => new Date(start + i * HOUR_MS));
}

function hourly(now: Date) {
  return {
    properties: {
      periods: hoursFrom(now).map((startsAt) => ({
        startTime: iso(startsAt),
        endTime: iso(new Date(startsAt.getTime() + HOUR_MS)),
        temperature: 72,
        temperatureUnit: "F",
        probabilityOfPrecipitation: {
          unitCode: "wmoUnit:percent",
          value: stormy(startsAt) ? 70 : 10,
        },
        shortForecast: stormy(startsAt)
          ? "Showers And Thunderstorms"
          : "Partly Cloudy",
      })),
    },
  };
}

function grid(now: Date) {
  const hours = hoursFrom(now);
  const layer = (value: (at: Date) => number) => ({
    uom: "wmoUnit:mm",
    values: hours.map((at) => ({
      validTime: `${iso(at)}/PT1H`,
      value: value(at),
    })),
  });
  return {
    properties: {
      quantitativePrecipitation: layer((at) => (stormy(at) ? 2 : 0)),
      probabilityOfThunder: {
        ...layer((at) => (stormy(at) ? 40 : 0)),
        uom: "wmoUnit:percent",
      },
    },
  };
}

/** Routine reports at :51 for two days; 4 mm an hour for four hours, ending 8 hours ago. */
function observations(now: Date) {
  const lastReport = new Date(
    Math.floor((now.getTime() - 51 * 60_000) / HOUR_MS) * HOUR_MS + 51 * 60_000,
  );
  return {
    features: Array.from({ length: 48 }, (_, i) => {
      const at = new Date(lastReport.getTime() - i * HOUR_MS);
      const wet = i >= 8 && i < 12;
      return {
        properties: {
          timestamp: iso(at),
          textDescription: wet ? "Rain" : "Cloudy",
          precipitationLastHour: {
            unitCode: "wmoUnit:mm",
            value: wet ? 4 : null,
          },
        },
      };
    }),
  };
}

/** A fetch that answers every NWS address the client asks for. */
export function weatherFixtureFetch(
  clock: () => Date = () => new Date(),
): WeatherFetch {
  return async (address) => {
    const url = new URL(address);
    const now = clock();
    if (url.origin !== NWS_ORIGIN)
      return { ok: false, status: 404, json: async () => null };
    const path = url.pathname;
    if (path.startsWith("/points/")) return ok(pointFixture);
    if (path.endsWith("/forecast/hourly")) return ok(hourly(now));
    if (path.endsWith("/stations")) return ok(stationsFixture);
    if (path.startsWith("/gridpoints/")) return ok(grid(now));
    if (/^\/stations\/[A-Z0-9]+\/observations$/.test(path))
      return ok(observations(now));
    if (path === "/alerts/active") return ok({ features: [] });
    return { ok: false, status: 404, json: async () => null };
  };
>>>>>>> 33a274e5 (feat(weather): read rainfall, nearby gauges and alerts from NWS into a rain-out decision)
}
