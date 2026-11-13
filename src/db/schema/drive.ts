import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EventId,
  GiveawayEntryId,
  GiveawayId,
  GiveawayWinnerId,
  SeasonId,
  SignupChallengeId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { event } from "./event";
import { season } from "./season";
import { teamSeason } from "./team";

/**
 * The sign-up drive (docs/data-model.md, section 2.5; ADR 0035): a free
 * giveaway at an event, and a season's team sign-up challenge.
 */

/**
 * A free giveaway at an event. Entry is free: a player enters by scanning
 * the giveaway's rotating code at the event, and nothing here points at a
 * purchase, ticket or registration fee. checkin_secret signs that code and
 * never leaves the server. drawn_at is set by the first draw; after it the
 * prize, winner count and window are fixed.
 */
export const giveaway = pgTable(
  "giveaway",
  {
    id: uuid().primaryKey().defaultRandom().$type<GiveawayId>(),
    eventId: uuid()
      .notNull()
      .unique("giveaway_one_per_event")
      .$type<EventId>()
      .references(() => event.id, { onDelete: "cascade" }),
    prize: text().notNull(),
    /** Often a sponsor's: "Two tickets, donated by the home bar". */
    donatedBy: text(),
    winnerCount: smallint().notNull().default(1),
    opensAt: timestamp({ withTimezone: true }).notNull(),
    closesAt: timestamp({ withTimezone: true }).notNull(),
    officialRules: text().notNull(),
    checkinSecret: text().notNull(),
    drawnAt: timestamp({ withTimezone: true }),
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
      "giveaway_prize_length",
      sql`char_length(${t.prize}) between 1 and 200`,
    ),
    check(
      "giveaway_donated_by_length",
      sql`${t.donatedBy} is null or char_length(${t.donatedBy}) between 1 and 80`,
    ),
    check("giveaway_winner_count", sql`${t.winnerCount} between 1 and 20`),
    check("giveaway_window_order", sql`${t.closesAt} > ${t.opensAt}`),
    check(
      "giveaway_rules_length",
      sql`char_length(${t.officialRules}) between 20 and 5000`,
    ),
    check(
      "giveaway_checkin_secret_length",
      sql`char_length(${t.checkinSecret}) >= 32`,
    ),
  ],
);

/** One person's entry: one per giveaway, made by checking in at the event. */
export const giveawayEntry = pgTable(
  "giveaway_entry",
  {
    id: uuid().primaryKey().defaultRandom().$type<GiveawayEntryId>(),
    giveawayId: uuid()
      .notNull()
      .$type<GiveawayId>()
      .references(() => giveaway.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    enteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("giveaway_entry_once").on(t.giveawayId, t.userId),
    index("giveaway_entry_user_idx").on(t.userId),
  ],
);

/**
 * A drawn winner. round 1 is the first draw; each redraw replaces one
 * winner and adds a row with the next round. A replaced winner keeps their
 * row (replaced_at and the reason), and an entry wins at most once, so a
 * replaced winner is never drawn again.
 */
export const giveawayWinner = pgTable(
  "giveaway_winner",
  {
    id: uuid().primaryKey().defaultRandom().$type<GiveawayWinnerId>(),
    giveawayId: uuid()
      .notNull()
      .$type<GiveawayId>()
      .references(() => giveaway.id, { onDelete: "cascade" }),
    entryId: uuid()
      .notNull()
      .$type<GiveawayEntryId>()
      .references(() => giveawayEntry.id, { onDelete: "cascade" }),
    round: smallint().notNull(),
    drawnAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    drawnBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    replacedAt: timestamp({ withTimezone: true }),
    replacedReason: text(),
  },
  (t) => [
    unique("giveaway_winner_once").on(t.giveawayId, t.entryId),
    index("giveaway_winner_entry_idx").on(t.entryId),
    check("giveaway_winner_round", sql`${t.round} >= 1`),
    check(
      "giveaway_winner_replaced_reason",
      sql`(${t.replacedAt} is null) = (${t.replacedReason} is null)`,
    ),
    check(
      "giveaway_winner_reason_length",
      sql`${t.replacedReason} is null or char_length(${t.replacedReason}) between 5 and 300`,
    ),
  ],
);

/**
 * A season's team sign-up challenge: the first team whose whole roster has
 * an account and has signed the waiver wins the prize. Progress is read
 * from the rosters, never stored; the winner is stored once an admin
 * confirms it. One challenge per season.
 */
export const signupChallenge = pgTable(
  "signup_challenge",
  {
    id: uuid().primaryKey().defaultRandom().$type<SignupChallengeId>(),
    seasonId: uuid()
      .notNull()
      .unique("signup_challenge_one_per_season")
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    prize: text().notNull(),
    deadline: timestamp({ withTimezone: true }).notNull(),
    // Set null when the seed or an admin removes the team's season entry.
    winnerTeamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "set null" }),
    /** When the winner's last player finished signing up. */
    winnerCompletedAt: timestamp({ withTimezone: true }),
    confirmedAt: timestamp({ withTimezone: true }),
    confirmedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
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
      "signup_challenge_prize_length",
      sql`char_length(${t.prize}) between 1 and 200`,
    ),
    check(
      "signup_challenge_winner_confirmed",
      sql`${t.winnerTeamSeasonId} is null or ${t.confirmedAt} is not null`,
    ),
  ],
);
