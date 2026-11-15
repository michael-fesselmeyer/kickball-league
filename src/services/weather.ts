import { z } from "zod";
import { err, ok, type Result } from "@/domain/result";
import type {
  GridHour,
  Observation,
  WeatherAlert,
} from "@/domain/weather/decision";
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

const pointLinksSchema = z.object({
  properties: z.object({
    forecastHourly: z.url(),
    forecastGridData: z.url(),
    observationStations: z.url(),
  }),
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

/*
 * For the rain-out decision (ADR 0057): the grid square's raw forecast
 * (expected rainfall and chance of thunder), the observation stations
 * nearest the point, what the nearest one measured, and the active alerts
 * for the point. Each is one request, checked with a schema.
 */

/** Where a place's forecasts and nearest stations live. */
export type PointLinks = {
  hourly: string;
  grid: string;
  stations: string;
};

const onNws = (url: string) => url.startsWith(`${NWS_ORIGIN}/`);

export function parsePointLinks(body: unknown): Result<PointLinks, string> {
  const parsed = pointLinksSchema.safeParse(body);
  if (!parsed.success) return err("The point lookup was not readable");
  const p = parsed.data.properties;
  const links = {
    hourly: p.forecastHourly,
    grid: p.forecastGridData,
    stations: p.observationStations,
  };
  if (!Object.values(links).every(onNws))
    return err("The point lookup named another host");
  return ok(links);
}

export async function nwsPointLinks(
  lat: number,
  lng: number,
  options: NwsOptions,
): Promise<Result<PointLinks, string>> {
  const body = await getJson(pointUrl(lat, lng), options);
  return body.ok ? parsePointLinks(body.value) : body;
}

const HOUR_MS = 3_600_000;
const MM_PER_IN = 25.4;

/** Whole hours in an ISO 8601 duration such as PT3H or P1DT6H. */
export function durationHours(duration: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration);
  if (!m) return null;
  const hours =
    Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60;
  return hours > 0 ? Math.ceil(hours) : null;
}

const layerSchema = z.object({
  uom: z.string().optional(),
  values: z.array(
    z.object({ validTime: z.string(), value: z.number().nullable() }),
  ),
});

const gridSchema = z.object({
  properties: z.object({
    quantitativePrecipitation: layerSchema,
    probabilityOfThunder: layerSchema.optional(),
  }),
});

/** A grid layer spread over whole hours: "18:00/PT3H" covers three. */
function byHour(
  layer: z.infer<typeof layerSchema>,
  share: (value: number, hours: number) => number,
): Map<number, number> | null {
  const out = new Map<number, number>();
  for (const v of layer.values) {
    const [start, duration] = v.validTime.split("/");
    const startsAt = start ? Date.parse(start) : Number.NaN;
    const hours = duration ? durationHours(duration) : null;
    if (Number.isNaN(startsAt) || hours === null) return null;
    for (let i = 0; i < hours; i++)
      out.set(startsAt + i * HOUR_MS, share(v.value ?? 0, hours));
  }
  return out;
}

/** Expected rainfall per hour in inches, and the chance of thunder when given. */
export function parseGrid(body: unknown): Result<GridHour[], string> {
  const parsed = gridSchema.safeParse(body);
  if (!parsed.success) return err("The grid forecast was not readable");
  const { quantitativePrecipitation: qpf, probabilityOfThunder } =
    parsed.data.properties;
  const toIn = qpf.uom === "wmoUnit:m" ? 1000 / MM_PER_IN : 1 / MM_PER_IN;
  const rain = byHour(qpf, (v, hours) => (v * toIn) / hours);
  const thunder = probabilityOfThunder
    ? byHour(probabilityOfThunder, (v) => v)
    : new Map<number, number>();
  if (!rain || !thunder) return err("The grid forecast had a bad time");
  return ok(
    [...rain]
      .sort((a, b) => a[0] - b[0])
      .map(([t, rainIn]) => ({
        startsAt: new Date(t),
        rainIn,
        thunderChance: thunder.get(t) ?? null,
      })),
  );
}

export async function nwsGrid(
  url: string,
  options: NwsOptions,
): Promise<Result<GridHour[], string>> {
  if (!onNws(url)) return err("Not a forecast service address");
  const body = await getJson(url, options);
  return body.ok ? parseGrid(body.value) : body;
}

export type Station = { id: string; name: string };

const STATION_ID = /^[A-Z0-9]{3,6}$/;

const stationsSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        stationIdentifier: z.string().regex(STATION_ID),
        name: z.string(),
      }),
    }),
  ),
});

/** The stations near a grid square, nearest first, as NWS lists them. */
export function parseStations(body: unknown): Result<Station[], string> {
  const parsed = stationsSchema.safeParse(body);
  if (!parsed.success) return err("The station list was not readable");
  return ok(
    parsed.data.features.map((f) => ({
      id: f.properties.stationIdentifier,
      name: f.properties.name,
    })),
  );
}

export async function nwsStations(
  url: string,
  options: NwsOptions,
): Promise<Result<Station[], string>> {
  if (!onNws(url)) return err("Not a forecast service address");
  const body = await getJson(url, options);
  return body.ok ? parseStations(body.value) : body;
}

const quantity = z
  .object({ value: z.number().nullable(), unitCode: z.string().optional() })
  .nullish();

const observationsSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        timestamp: z.iso.datetime({ offset: true }),
        precipitationLastHour: quantity,
      }),
    }),
  ),
});

/** A station's reports, with the rain since its last hourly report in mm. */
export function parseObservations(
  body: unknown,
): Result<Observation[], string> {
  const parsed = observationsSchema.safeParse(body);
  if (!parsed.success) return err("The station's reports were not readable");
  return ok(
    parsed.data.features.map((f) => {
      const rain = f.properties.precipitationLastHour;
      const value = rain?.value ?? null;
      return {
        at: new Date(f.properties.timestamp),
        lastHourMm:
          value === null
            ? null
            : rain?.unitCode === "wmoUnit:m"
              ? value * 1000
              : value,
      };
    }),
  );
}

/** A station's reports since a time, which NWS takes without milliseconds. */
export const observationsUrl = (stationId: string, since: Date): string =>
  `${NWS_ORIGIN}/stations/${stationId}/observations?start=${since
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")}`;

export async function nwsObservations(
  stationId: string,
  since: Date,
  options: NwsOptions,
): Promise<Result<Observation[], string>> {
  if (!STATION_ID.test(stationId)) return err("Not a station");
  const body = await getJson(observationsUrl(stationId, since), options);
  return body.ok ? parseObservations(body.value) : body;
}

const alertsSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        event: z.string(),
        headline: z.string().nullish(),
        severity: z.string(),
        ends: z.iso.datetime({ offset: true }).nullish(),
        expires: z.iso.datetime({ offset: true }).nullish(),
      }),
    }),
  ),
});

/** The alerts in effect for a point. */
export function parseAlerts(body: unknown): Result<WeatherAlert[], string> {
  const parsed = alertsSchema.safeParse(body);
  if (!parsed.success) return err("The alerts were not readable");
  return ok(
    parsed.data.features.map(({ properties: p }) => {
      const ends = p.ends ?? p.expires ?? null;
      return {
        event: p.event,
        headline: p.headline ?? null,
        severity: p.severity,
        endsAt: ends ? new Date(ends) : null,
      };
    }),
  );
}

export const alertsUrl = (lat: number, lng: number): string =>
  `${NWS_ORIGIN}/alerts/active?point=${roundCoordinate(lat)},${roundCoordinate(lng)}`;

export async function nwsAlerts(
  lat: number,
  lng: number,
  options: NwsOptions,
): Promise<Result<WeatherAlert[], string>> {
  const body = await getJson(alertsUrl(lat, lng), options);
  return body.ok ? parseAlerts(body.value) : body;
}
