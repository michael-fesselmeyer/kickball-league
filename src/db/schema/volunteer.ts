import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EventId,
  LeagueId,
  SeasonId,
  UserId,
  VolunteerShiftId,
  VolunteerSignupId,
} from "@/domain/ids";
import { user } from "./auth";
import { event } from "./event";
import { league } from "./league";
import { season } from "./season";

/** What the volunteer does (src/domain/volunteer/shifts.ts has the labels). */
export const volunteerRole = pgEnum("volunteer_role", [
  "setup",
  "teardown",
  "check_in",
  "ref_fill_in",
]);

/**
 * A volunteer shift (docs/data-model.md, section 2.5): a job on a season's
 * game day or at an event, with a fixed number of spots. Exactly one of
 * season_id and event_id is set. Members claim spots in volunteer_signup;
 * a claim locks this row, so a shift never takes more people than spots.
 */
export const volunteerShift = pgTable(
  "volunteer_shift",
  {
    id: uuid().primaryKey().defaultRandom().$type<VolunteerShiftId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    role: volunteerRole().notNull(),
    /** A game-day shift: the season whose game day it is. */
    seasonId: uuid()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    /** An event shift. */
    eventId: uuid()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "cascade" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    place: text(),
    notes: text().notNull().default(""),
    spots: smallint().notNull(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "volunteer_shift_one_occasion",
      sql`(${t.seasonId} is null) <> (${t.eventId} is null)`,
    ),
    check("volunteer_shift_ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    check("volunteer_shift_spots", sql`${t.spots} between 1 and 50`),
    check(
      "volunteer_shift_place_length",
      sql`${t.place} is null or char_length(${t.place}) between 1 and 120`,
    ),
    check("volunteer_shift_notes_length", sql`char_length(${t.notes}) <= 500`),
    index("volunteer_shift_league_starts_idx").on(t.leagueId, t.startsAt),
    index("volunteer_shift_season_idx").on(t.seasonId),
    index("volunteer_shift_event_idx").on(t.eventId),
  ],
);

/** One member's spot on a shift: one per person per shift. */
export const volunteerSignup = pgTable(
  "volunteer_signup",
  {
    id: uuid().primaryKey().defaultRandom().$type<VolunteerSignupId>(),
    shiftId: uuid()
      .notNull()
      .$type<VolunteerShiftId>()
      .references(() => volunteerShift.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("volunteer_signup_once").on(t.shiftId, t.userId),
    index("volunteer_signup_user_idx").on(t.userId),
  ],
);

export type VolunteerShift = typeof volunteerShift.$inferSelect;
export type VolunteerSignup = typeof volunteerSignup.$inferSelect;
