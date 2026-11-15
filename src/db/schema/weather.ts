import {
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** The parts of a park's weather the rain-out decision reads (ADR 0057). */
export const weatherPart = pgEnum("weather_part", [
  "forecast",
  "observed",
  "alerts",
]);

/**
 * The last good National Weather Service answer for each part of a park's
 * weather, so the rain-out decision card can show the last data, and when
 * it was fetched, while NWS is down. One row per park and part, replaced
 * by newer answers only; pages still read NWS through the data cache
 * first. See docs/data-model.md, section 2.11.
 */
export const weatherSnapshot = pgTable(
  "weather_snapshot",
  {
    /** The park's point, "lat,lng" at the four decimals NWS takes. */
    place: text().notNull(),
    part: weatherPart().notNull(),
    /** The parsed answer, with times as ISO strings. */
    data: jsonb().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.place, t.part] })],
);
