import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AwayWeekId, RegistrationId } from "@/domain/ids";
import { registration } from "./team";

/**
 * A week of a season a player says they'll miss (src/domain/availability).
 * Named by the week's Monday in the league's time zone. Tied to the
 * registration, so it belongs to one person in one season and goes when
 * the registration does. Only the player, their captains and admins see it
 * (docs/data-model.md, section 4).
 */
export const awayWeek = pgTable(
  "away_week",
  {
    id: uuid().primaryKey().defaultRandom().$type<AwayWeekId>(),
    registrationId: uuid()
      .notNull()
      .$type<RegistrationId>()
      .references(() => registration.id, { onDelete: "cascade" }),
    weekStart: date({ mode: "string" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("away_week_once").on(t.registrationId, t.weekStart),
    index("away_week_week_idx").on(t.weekStart),
    check("away_week_monday", sql`extract(isodow from ${t.weekStart}) = 1`),
  ],
);

export type AwayWeek = typeof awayWeek.$inferSelect;
