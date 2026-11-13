import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EventId,
  EventRsvpId,
  EventTicketId,
  LeagueId,
  PurchaseId,
  SeasonId,
  TeamId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { purchase } from "./money";
import { season } from "./season";
import { team } from "./team";

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
  "party",
]);

/**
 * Who sees an event and who can be told about it: everyone (public pages),
 * all members (anyone registered in any season), or the active rosters of
 * chosen teams (event_audience_team), in one season or in any.
 */
export const eventAudience = pgEnum("event_audience", [
  "public",
  "members",
  "teams",
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
    audience: eventAudience().notNull().default("public"),
    /**
     * For a teams audience: the season whose rosters count. Null means the
     * chosen teams' players from any season.
     */
    audienceSeasonId: uuid()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    /**
     * An external invite (Partiful or any https page). Shown and shared,
     * never fetched by the server.
     */
    inviteUrl: text(),
    /** Off when people RSVP only through the invite link. */
    inAppRsvp: boolean().notNull().default(true),
    /**
     * A ticketed event's price; null for a free one. A spot then comes with
     * a ticket bought through Stripe Checkout (event_ticket).
     */
    ticketPriceCents: integer(),
    /** A lower price for members; null means members pay the ticket price. */
    memberPriceCents: integer(),
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
    check(
      "event_theme_week_public",
      sql`${t.kind} <> 'theme_week' or ${t.audience} = 'public'`,
    ),
    check(
      "event_audience_season_teams",
      sql`${t.audience} = 'teams' or ${t.audienceSeasonId} is null`,
    ),
    check(
      "event_invite_url_https",
      sql`${t.inviteUrl} is null or (${t.inviteUrl} ~ '^https://' and length(${t.inviteUrl}) <= 500)`,
    ),
    // Stripe takes no card payment under 50 cents; a member price may be
    // free, which issues the ticket with no payment at all.
    check(
      "event_price_range",
      sql`${t.ticketPriceCents} is null or ${t.ticketPriceCents} between 50 and 50000`,
    ),
    check(
      "event_member_price",
      sql`${t.memberPriceCents} is null or (${t.ticketPriceCents} is not null and ${t.memberPriceCents} <= ${t.ticketPriceCents} and (${t.memberPriceCents} = 0 or ${t.memberPriceCents} >= 50))`,
    ),
    // Tickets are sold in the app, and a theme week has nothing to attend.
    check(
      "event_ticket_sold_in_app",
      sql`${t.ticketPriceCents} is null or (${t.inAppRsvp} and ${t.kind} <> 'theme_week')`,
    ),
    index("event_league_starts_idx").on(t.leagueId, t.startsAt),
  ],
);

/** The teams an event with a teams audience is for. */
export const eventAudienceTeam = pgTable(
  "event_audience_team",
  {
    eventId: uuid()
      .notNull()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "cascade" }),
    teamId: uuid()
      .notNull()
      .$type<TeamId>()
      .references(() => team.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.teamId] }),
    index("event_audience_team_team_idx").on(t.teamId),
  ],
);

/**
 * A person's private events calendar feed. Its link carries a signature of
 * the user id and this version, so the link itself is never stored, and
 * resetting it (a new version) stops the old link working.
 */
export const calendarFeed = pgTable("calendar_feed", {
  userId: uuid()
    .primaryKey()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "cascade" }),
  version: integer().notNull().default(1),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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

/**
 * offered: a spot held for the next person on a ticketed event's waitlist
 * until held_until. held: a spot held while its Checkout is open, until
 * held_until. paid: a ticket (the person also has a going RSVP). refunded:
 * the league gave the money back and the spot went to the waitlist.
 * released: an offer or a checkout that ended unpaid. cancelled: given up
 * when its holder deleted their account.
 */
export const eventTicketStatus = pgEnum("event_ticket_status", [
  "offered",
  "held",
  "paid",
  "refunded",
  "released",
  "cancelled",
]);

/**
 * A spot on a ticketed event, from an offer or a checkout's hold to a paid
 * ticket. Only the Stripe webhook (or credit that covers the whole price)
 * makes it paid. A spot counts against the capacity while it is paid, or
 * offered or held until held_until.
 */
export const eventTicket = pgTable(
  "event_ticket",
  {
    id: uuid().primaryKey().defaultRandom().$type<EventTicketId>(),
    eventId: uuid()
      .notNull()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    /** The checkout that pays for it; an offer has none yet. */
    purchaseId: uuid()
      .$type<PurchaseId>()
      .references(() => purchase.id, { onDelete: "restrict" }),
    status: eventTicketStatus().notNull(),
    /** The price before league credit: the member price or the full one. */
    priceCents: integer(),
    /** Shown on the ticket and read out at the door. */
    code: text().notNull(),
    heldUntil: timestamp({ withTimezone: true }),
    checkedInAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("event_ticket_code_unique").on(t.eventId, t.code),
    unique("event_ticket_purchase_unique").on(t.purchaseId),
    index("event_ticket_event_status_idx").on(t.eventId, t.status),
    index("event_ticket_user_idx").on(t.userId),
    check("event_ticket_code_format", sql`${t.code} ~ '^[A-HJ-NP-Z2-9]{6}$'`),
    check(
      "event_ticket_held_until",
      sql`(${t.status} in ('offered', 'held')) = (${t.heldUntil} is not null)`,
    ),
    check(
      "event_ticket_purchase",
      sql`${t.status} in ('offered', 'released', 'cancelled') or (${t.purchaseId} is not null and ${t.priceCents} is not null)`,
    ),
    check(
      "event_ticket_price_cents",
      sql`${t.priceCents} is null or ${t.priceCents} >= 0`,
    ),
  ],
);

export type Event = typeof event.$inferSelect;
export type EventTicket = typeof eventTicket.$inferSelect;
export type EventRsvp = typeof eventRsvp.$inferSelect;
