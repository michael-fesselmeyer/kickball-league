import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { EventId, EventRsvpId, LeagueId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";

/**
 * What an event is, for its label. A theme week is different: it runs whole
 * days and marks the game days inside it on the public schedule, with
 * nothing to RSVP to.
 */
export const eventKind = pgEnum("event_kind", [
  "social",
  "bar_night",
  "bbq",
  "tournament",
  "theme_week",
]);

/**
 * A league event: a bar night, a BBQ, a tournament or a theme week
 * (docs/data-model.md, section 2.5). Times are instants; a theme week starts
 * at midnight on its first day and ends at midnight after its last, in the
 * league's time zone. A null capacity means everyone fits.
 */
export const event = pgTable(
  "event",
  {
    id: uuid().primaryKey().defaultRandom().$type<EventId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    kind: eventKind().notNull().default("social"),
    title: text().notNull(),
    /** Set once from the title, so links keep working after an edit. */
    slug: text().notNull().unique(),
    place: text(),
    description: text().notNull().default(""),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    capacity: integer(),
    /** Called off: the page stays up and says so; RSVPs are closed. */
    cancelledAt: timestamp({ withTimezone: true }),
    /** Removed by an admin: gone from every page. */
    deletedAt: timestamp({ withTimezone: true }),
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
    check("event_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("event_ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "event_capacity_positive",
      sql`${t.capacity} is null or ${t.capacity} > 0`,
    ),
    check(
      "event_theme_week_open",
      sql`${t.kind} <> 'theme_week' or ${t.capacity} is null`,
    ),
    index("event_league_starts_idx").on(t.leagueId, t.startsAt),
  ],
);

/**
 * going: has a spot. waitlisted: the event was full; the earliest waitlisted
 * person moves up when a spot opens. "Can't make it" removes the row.
 */
export const eventRsvpStatus = pgEnum("event_rsvp_status", [
  "going",
  "waitlisted",
]);

/** One person's RSVP for an event. Waitlist order is created_at. */
export const eventRsvp = pgTable(
  "event_rsvp",
  {
    id: uuid().primaryKey().defaultRandom().$type<EventRsvpId>(),
    eventId: uuid()
      .notNull()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    status: eventRsvpStatus().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("event_rsvp_once").on(t.eventId, t.userId),
    index("event_rsvp_queue_idx").on(t.eventId, t.status, t.createdAt),
    index("event_rsvp_user_idx").on(t.userId),
  ],
);

export type Event = typeof event.$inferSelect;
export type EventRsvp = typeof eventRsvp.$inferSelect;
