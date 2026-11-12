import { z } from "zod";
import { err, ok, type Result } from "@/domain/result";
import type { ForecastHour } from "@/domain/weather/forecast";

/**
 * The National Weather Service API (docs/adr/0005-weather-forecast-source.md):
 * free, public domain, and keyless. It asks every caller for a User-Agent
 * that says who is calling. A forecast is two requests: the point, which
 * names the forecast office's grid square, then that square's hourly
 * forecast.
 */

export const NWS_ORIGIN = "https://api.weather.gov";

export type WeatherFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type NwsOptions = {
  userAgent: string;
  /** Injected in tests, which never touch the network. */
  fetch?: WeatherFetch;
  /** A slow answer counts as no answer. */
  timeoutMs?: number;
};

const pointSchema = z.object({
  properties: z.object({ forecastHourly: z.url() }),
});

const hourlySchema = z.object({
  properties: z.object({
    periods: z.array(
      z.object({
        startTime: z.iso.datetime({ offset: true }),
        endTime: z.iso.datetime({ offset: true }),
        temperature: z.number(),
        temperatureUnit: z.enum(["F", "C"]),
        probabilityOfPrecipitation: z
          .object({ value: z.number().nullable() })
          .nullish(),
        shortForecast: z.string(),
      }),
    ),
  }),
});

/** NWS takes at most four decimal places and redirects anything longer. */
export const roundCoordinate = (value: number): number =>
  Math.round(value * 10_000) / 10_000;

export const pointUrl = (lat: number, lng: number): string =>
  `${NWS_ORIGIN}/points/${roundCoordinate(lat)},${roundCoordinate(lng)}`;

async function getJson(
  url: string,
  options: NwsOptions,
): Promise<Result<unknown, string>> {
  const doFetch: WeatherFetch = options.fetch ?? fetch;
  try {
    const res = await doFetch(url, {
      headers: {
        "User-Agent": options.userAgent,
        Accept: "application/geo+json",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
    });
    if (!res.ok) return err(`The forecast service answered ${res.status}`);
    return ok(await res.json());
  } catch (e) {
    return err(
      e instanceof Error && e.name === "TimeoutError"
        ? "The forecast service took too long"
        : "The forecast service could not be reached",
    );
  }
}

/** The hourly forecast address for a place, from its point lookup. */
export function parsePoint(body: unknown): Result<string, string> {
  const parsed = pointSchema.safeParse(body);
  if (!parsed.success) return err("The point lookup had no hourly forecast");
  if (!parsed.data.properties.forecastHourly.startsWith(`${NWS_ORIGIN}/`))
    return err("The point lookup named another host");
  return ok(parsed.data.properties.forecastHourly);
}

const toF = (value: number, unit: "F" | "C") =>
  unit === "F" ? value : (value * 9) / 5 + 32;

/** Hourly periods in the league's units. A missing chance of rain counts as 0. */
export function parseHourly(body: unknown): Result<ForecastHour[], string> {
  const parsed = hourlySchema.safeParse(body);
  if (!parsed.success) return err("The hourly forecast was not readable");
  return ok(
    parsed.data.properties.periods.map((p) => ({
      startsAt: new Date(p.startTime),
      endsAt: new Date(p.endTime),
      temperatureF: toF(p.temperature, p.temperatureUnit),
      precipChance: p.probabilityOfPrecipitation?.value ?? 0,
      summary: p.shortForecast,
    })),
  );
}

/** Looks up where a place's hourly forecast lives. It changes rarely. */
export async function nwsHourlyUrl(
  lat: number,
  lng: number,
  options: NwsOptions,
): Promise<Result<string, string>> {
  const body = await getJson(pointUrl(lat, lng), options);
  return body.ok ? parsePoint(body.value) : body;
}

/** Fetches an hourly forecast from the address `nwsHourlyUrl` gave. */
export async function nwsHourly(
  url: string,
  options: NwsOptions,
): Promise<Result<ForecastHour[], string>> {
  if (!url.startsWith(`${NWS_ORIGIN}/`))
    return err("Not a forecast service address");
  const body = await getJson(url, options);
  return body.ok ? parseHourly(body.value) : body;
}
