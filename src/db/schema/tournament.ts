import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  boolean,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EventId,
  FriendLeagueId,
  GuestTeamId,
  GuestWaiverSignatureId,
  WaiverId,
} from "@/domain/ids";
import type { TournamentBracket } from "@/domain/tournaments/bracket";
import { event } from "./event";
import { friendLeague } from "./friends";
import { waiver } from "./waiver";

/**
 * The tournament side of an event of kind "tournament" (ADR 0064): whether
 * it takes guest teams from other leagues, an optional charity link, and the
 * bracket. One row per event, made by an admin.
 */
export const tournament = pgTable(
  "tournament",
  {
    eventId: uuid()
      .primaryKey()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "cascade" }),
    /** Guest captains can sign up while this is on. */
    guestSignupsOpen: boolean().notNull().default(true),
    /** Null means no cap on guest teams. */
    maxGuestTeams: integer(),
    /** The partner league on the Friends page that this tournament is with. */
    partnerFriendLeagueId: uuid()
      .$type<FriendLeagueId>()
      .references(() => friendLeague.id, { onDelete: "set null" }),
    /** Charity mode: a link out and a goal, never the money itself. */
    charityName: text(),
    charityUrl: text(),
    charityGoalCents: integer(),
    /** Guest names, emails and waiver signatures go this many days after it ends. */
    guestDataDays: integer().notNull().default(30),
    /** Set once the sweep has deleted the guest data. */
    guestDataDeletedAt: timestamp({ withTimezone: true }),
    /** Seeds and matches; team ids are guest_team ids, names are copied in. */
    bracket: jsonb().$type<TournamentBracket>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "tournament_max_guest_teams",
      sql`${t.maxGuestTeams} is null or ${t.maxGuestTeams} between 1 and 32`,
    ),
    check(
      "tournament_guest_data_days",
      sql`${t.guestDataDays} between 1 and 90`,
    ),
    check(
      "tournament_charity_pair",
      sql`(${t.charityName} is null) = (${t.charityUrl} is null)`,
    ),
    check(
      "tournament_charity_url_https",
      sql`${t.charityUrl} is null or (${t.charityUrl} ~ '^https://' and char_length(${t.charityUrl}) <= 300)`,
    ),
    check(
      "tournament_charity_name_length",
      sql`${t.charityName} is null or char_length(${t.charityName}) between 1 and 80`,
    ),
    check(
      "tournament_charity_goal",
      sql`${t.charityGoalCents} is null or (${t.charityUrl} is not null and ${t.charityGoalCents} between 100 and 100000000)`,
    ),
  ],
);

/**
 * A guest team from another league, entered by its captain with no account.
 * The captain's name and email are kept only to reach them about the event;
 * they and every signature are deleted guest_data_days after it ends.
 * link_token is the secret in the waiver link the captain shares.
 */
export const guestTeam = pgTable(
  "guest_team",
  {
    id: uuid().primaryKey().defaultRandom().$type<GuestTeamId>(),
    eventId: uuid()
      .notNull()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "cascade" }),
    name: text().notNull(),
    captainName: text().notNull(),
    captainEmail: text().notNull(),
    rosterSize: integer().notNull(),
    linkToken: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("guest_team_name_unique").on(t.eventId, sql`lower(${t.name})`),
    uniqueIndex("guest_team_token_unique").on(t.linkToken),
    index("guest_team_event_idx").on(t.eventId, t.createdAt),
    check(
      "guest_team_name_length",
      sql`char_length(${t.name}) between 1 and 60`,
    ),
    check(
      "guest_team_captain_length",
      sql`char_length(${t.captainName}) between 1 and 80 and char_length(${t.captainEmail}) between 3 and 254`,
    ),
    check("guest_team_roster_size", sql`${t.rosterSize} between 4 and 30`),
  ],
);

/**
 * One guest player's waiver signature, by link: the typed name, the time and
 * a hash of the exact text shown. No IP or browser is kept for a guest.
 */
export const guestWaiverSignature = pgTable(
  "guest_waiver_signature",
  {
    id: uuid().primaryKey().defaultRandom().$type<GuestWaiverSignatureId>(),
    guestTeamId: uuid()
      .notNull()
      .$type<GuestTeamId>()
      .references(() => guestTeam.id, { onDelete: "cascade" }),
    waiverId: uuid()
      .notNull()
      .$type<WaiverId>()
      .references(() => waiver.id, { onDelete: "restrict" }),
    signedName: text().notNull(),
    signedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    bodySha256: text().notNull(),
  },
  (t) => [
    uniqueIndex("guest_waiver_signature_once").on(
      t.guestTeamId,
      sql`lower(${t.signedName})`,
    ),
    check(
      "guest_waiver_signature_name_length",
      sql`char_length(${t.signedName}) between 3 and 80`,
    ),
    check(
      "guest_waiver_signature_sha256",
      sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type Tournament = typeof tournament.$inferSelect;
export type GuestTeam = typeof guestTeam.$inferSelect;
