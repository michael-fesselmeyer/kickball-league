import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ConcernId,
  ConcernMessageId,
  GameId,
  LeagueId,
  TeamId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { game } from "./game";
import { league } from "./league";
import { team } from "./team";

/** Where a concern came from: the public contact form, or a signed-in player. */
export const concernSource = pgEnum("concern_source", ["public", "player"]);

export const concernCategory = pgEnum("concern_category", [
  "question",
  "field_problem",
  "play",
  "safety",
  "treatment",
  "park_rules",
  "other",
]);

/** What a park-rules concern (or incident) is about, so a season's can be counted. */
export const parkRule = pgEnum("park_rule", [
  "outside_hours",
  "alcohol_glass",
  "amplified_sound",
  "litter",
  "field_damage",
  "shared_space",
]);

export const concernStatus = pgEnum("concern_status", ["open", "closed"]);

/** A reply the sender sees, or an admin-only note. */
export const concernMessageKind = pgEnum("concern_message_kind", [
  "reply",
  "note",
]);

/**
 * Something a person tells the league: a private concern from a signed-in
 * player, or a message from the public contact form (docs/data-model.md,
 * section 2.7). Both land in one admin queue. A concern is read only by the
 * league's admins and its sender, never by a team or the public. The reply
 * address of a public sender is cleared 12 months after the concern closes.
 */
export const concern = pgTable(
  "concern",
  {
    id: uuid().primaryKey().defaultRandom().$type<ConcernId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    source: concernSource().notNull(),
    category: concernCategory().notNull(),
    parkRule: parkRule(),
    body: text().notNull(),
    /** Public form: the day it happened, if the sender gave one. */
    occurredOn: date({ mode: "string" }),
    /** Public form: which field or where in the park, in the sender's words. */
    place: text(),
    /** Player concern: a game it is about. Admins only, never shown to a team. */
    gameId: uuid()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "set null" }),
    teamId: uuid()
      .$type<TeamId>()
      .references(() => team.id, { onDelete: "set null" }),
    /** Null for a public sender, and once the sender's account is deleted. */
    senderId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** Where a public sender wants the reply. Cleared 12 months after closing. */
    replyEmail: text(),
    status: concernStatus().notNull().default("open"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** When an admin first replied to the sender: the time to first reply. */
    firstRepliedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    closedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** What was done, written when an admin closes it. */
    outcome: text(),
  },
  (t) => [
    index("concern_queue_idx").on(t.leagueId, t.status, t.createdAt),
    index("concern_sender_idx").on(t.senderId),
    index("concern_game_idx").on(t.gameId),
    index("concern_purge_idx")
      .on(t.closedAt)
      .where(sql`${t.replyEmail} is not null`),
    check(
      "concern_body_length",
      sql`char_length(${t.body}) between 1 and 2000`,
    ),
    check(
      "concern_place_length",
      sql`${t.place} is null or char_length(${t.place}) between 1 and 80`,
    ),
    check(
      "concern_reply_email_length",
      sql`${t.replyEmail} is null or char_length(${t.replyEmail}) between 3 and 254`,
    ),
    check(
      "concern_outcome_length",
      sql`${t.outcome} is null or char_length(${t.outcome}) between 1 and 1000`,
    ),
    check(
      "concern_park_rule_category",
      sql`${t.parkRule} is null or ${t.category} = 'park_rules'`,
    ),
    check(
      "concern_closed_at",
      sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`,
    ),
    check(
      "concern_public_has_no_sender",
      sql`${t.source} <> 'public' or ${t.senderId} is null`,
    ),
  ],
);

/** Replies and admin notes on a concern, oldest first. */
export const concernMessage = pgTable(
  "concern_message",
  {
    id: uuid().primaryKey().defaultRandom().$type<ConcernMessageId>(),
    concernId: uuid()
      .notNull()
      .$type<ConcernId>()
      .references(() => concern.id, { onDelete: "cascade" }),
    authorId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    kind: concernMessageKind().notNull(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("concern_message_concern_idx").on(t.concernId, t.createdAt),
    check(
      "concern_message_body_length",
      sql`char_length(${t.body}) between 1 and 2000`,
    ),
  ],
);
