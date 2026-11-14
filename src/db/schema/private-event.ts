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
import type { LeagueId, PrivateEventId, SeasonId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";

/**
 * Private leagues and tournaments (ADR 0049): an organization asks for one,
 * an admin accepts it as a private season of the league, and the organizer
 * shares an invite link with its teams. See docs/data-model.md.
 */
export const privateEventKind = pgEnum("private_event_kind", [
  "tournament",
  "league",
]);

export const privateEventStatus = pgEnum("private_event_status", [
  "requested",
  "accepted",
  "declined",
]);

/** Who pays: the organization once for every team, or players as usual. */
export const privateEventPayer = pgEnum("private_event_payer", [
  "organization",
  "players",
]);

export const PRIVATE_EVENT_MIN_TEAMS = 2;
export const PRIVATE_EVENT_MAX_TEAMS = 32;

export const privateEvent = pgTable(
  "private_event",
  {
    id: uuid().primaryKey().defaultRandom().$type<PrivateEventId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    /** The signed-in person who asked; their account holds the contact details. */
    organizerId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    kind: privateEventKind().notNull(),
    status: privateEventStatus().notNull().default("requested"),
    organization: text().notNull(),
    teams: integer().notNull(),
    /** In the organizer's words: "a Saturday in May", "Thursdays in June". */
    preferredDates: text().notNull(),
    note: text(),
    /** The private season, once accepted. */
    seasonId: uuid()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    payer: privateEventPayer(),
    /** What the organization pays for every team, when it pays. */
    priceCents: integer(),
    /** The secret in the invite link captains use to enter a team. */
    inviteToken: text(),
    paidAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    decidedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("private_event_season_unique").on(t.seasonId),
    unique("private_event_invite_token_unique").on(t.inviteToken),
    index("private_event_league_status_idx").on(
      t.leagueId,
      t.status,
      t.createdAt,
    ),
    index("private_event_organizer_idx").on(t.organizerId),
    check(
      "private_event_teams_range",
      sql`${t.teams} between ${sql.raw(String(PRIVATE_EVENT_MIN_TEAMS))} and ${sql.raw(String(PRIVATE_EVENT_MAX_TEAMS))}`,
    ),
    check(
      "private_event_text_lengths",
      sql`length(${t.organization}) between 1 and 120 and length(${t.preferredDates}) between 1 and 300 and coalesce(length(${t.note}), 0) <= 2000`,
    ),
    check(
      "private_event_accepted_has_season",
      sql`(${t.status} = 'accepted') = (${t.seasonId} is not null and ${t.payer} is not null and ${t.inviteToken} is not null)`,
    ),
    check(
      "private_event_price",
      sql`${t.priceCents} is null or ${t.priceCents} >= 0`,
    ),
    check(
      "private_event_organization_pays_price",
      sql`${t.payer} is distinct from 'organization' or ${t.priceCents} is not null`,
    ),
  ],
);

export type PrivateEvent = typeof privateEvent.$inferSelect;
