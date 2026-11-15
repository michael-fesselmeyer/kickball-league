import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { weatherSnapshot } from "../schema/weather";
import type { Db } from "./schedule";

/**
 * The last good National Weather Service answer for each part of a park's
 * weather (ADR 0048), so the rain-out card shows the last data while NWS
 * is down. Saved after a fresh answer; an older answer never replaces a
 * newer one. Read back through a schema, so a row in an old shape reads
 * as nothing rather than as wrong numbers.
 */

const date = z.coerce.date();

const forecastShape = z.object({
  hourly: z.array(
    z.object({
      startsAt: date,
      endsAt: date,
      temperatureF: z.number(),
      precipChance: z.number(),
      summary: z.string(),
    }),
  ),
  grid: z
    .array(
      z.object({
        startsAt: date,
        rainIn: z.number(),
        thunderChance: z.number().nullable(),
      }),
    )
    .nullable(),
});

const observedShape = z.object({
  station: z.object({ id: z.string(), name: z.string() }),
  reports: z.array(z.object({ at: date, lastHourMm: z.number().nullable() })),
});

const alertsShape = z.array(
  z.object({
    event: z.string(),
    headline: z.string().nullable(),
    severity: z.string(),
    endsAt: date.nullable(),
  }),
);

const SHAPES = {
  forecast: forecastShape,
  observed: observedShape,
  alerts: alertsShape,
} as const;

export type WeatherPart = keyof typeof SHAPES;
export type WeatherData<P extends WeatherPart> = z.infer<(typeof SHAPES)[P]>;

/** "40.7206,-73.9513": the point at the four decimals NWS takes. */
export const placeKey = (lat: number, lng: number): string =>
  `${Math.round(lat * 10_000) / 10_000},${Math.round(lng * 10_000) / 10_000}`;

/** Saves an answer unless a newer one for the same part is already there. */
export async function saveWeather<P extends WeatherPart>(
  db: Db,
  place: string,
  part: P,
  data: WeatherData<P>,
  fetchedAt: Date,
): Promise<void> {
  await db
    .insert(weatherSnapshot)
    .values({ place, part, data, fetchedAt })
    .onConflictDoUpdate({
      target: [weatherSnapshot.place, weatherSnapshot.part],
      set: { data, fetchedAt },
      setWhere: sql`${weatherSnapshot.fetchedAt} < excluded.fetched_at`,
    });
}

/** The last saved answer for a part, or null. */
export async function lastWeather<P extends WeatherPart>(
  db: Db,
  place: string,
  part: P,
): Promise<{ value: WeatherData<P>; fetchedAt: Date } | null> {
  const [row] = await db
    .select({
      data: weatherSnapshot.data,
      fetchedAt: weatherSnapshot.fetchedAt,
    })
    .from(weatherSnapshot)
    .where(
      and(eq(weatherSnapshot.place, place), eq(weatherSnapshot.part, part)),
    );
  if (!row) return null;
  const parsed = SHAPES[part].safeParse(row.data);
  return parsed.success
    ? { value: parsed.data as WeatherData<P>, fetchedAt: row.fetchedAt }
    : null;
}
