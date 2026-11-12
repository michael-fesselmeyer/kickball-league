import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AnnouncementId,
  MessageId,
  NotificationPreferenceId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";
import { teamSeason } from "./team";

/** What a message is about; people choose per topic what they receive. */
export const messageTopic = pgEnum("message_topic", [
  "rainout",
  "schedule_change",
  "game_reminder",
  "payment",
  "sub_request",
  "announcement",
  "score",
  "events",
  "marketing",
]);

/** Email for now; text and push arrive later behind the same outbox. */
export const messageChannel = pgEnum("message_channel", [
  "email",
  "sms",
  "push",
]);

/**
 * queued: waiting for send_after. sending: claimed by a worker until
 * locked_until. sent: the provider accepted it. failed: gave up after the
 * last attempt, or the message cannot be built. suppressed: not sent on
 * purpose (suppress_reason says why).
 */
export const messageStatus = pgEnum("message_status", [
  "queued",
  "sending",
  "sent",
  "failed",
  "suppressed",
]);

/**
 * The outbox: every notice the league sends is a row here, inserted in the
 * same transaction as the change that caused it, then delivered by a
 * worker. dedupe_key makes writing the same notice twice a no-op. See
 * docs/data-model.md, section 2.4, and docs/architecture.md, section 5.
 */
export const message = pgTable(
  "message",
  {
    id: uuid().primaryKey().defaultRandom().$type<MessageId>(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    topic: messageTopic().notNull(),
    channel: messageChannel().notNull().default("email"),
    /** Names the function in src/emails that renders `payload`. */
    template: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: messageStatus().notNull().default("queued"),
    suppressReason: text(),
    sendAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** While status is sending: when the claim lapses and the row may be retried. */
    lockedUntil: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
    dedupeKey: text().notNull(),
    providerMessageId: text(),
    sentAt: timestamp({ withTimezone: true }),
    /** Set when the message is one copy of an announcement. */
    announcementId: uuid()
      .$type<AnnouncementId>()
      .references(() => announcement.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("message_dedupe_key_unique").on(t.dedupeKey),
    index("message_announcement_idx").on(t.announcementId),
    index("message_due_idx")
      .on(t.sendAfter)
      .where(sql`${t.status} = 'queued'`),
    index("message_user_idx").on(t.userId, t.createdAt.desc()),
    check("message_attempts_non_negative", sql`${t.attempts} >= 0`),
    check(
      "message_sending_has_lock",
      sql`${t.status} <> 'sending' or ${t.lockedUntil} is not null`,
    ),
    check(
      "message_suppressed_has_reason",
      sql`${t.status} <> 'suppressed' or ${t.suppressReason} is not null`,
    ),
  ],
);

/**
 * A person's choice for one topic and channel. No row means the topic's
 * default, which is on for everything except marketing.
 */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: uuid().primaryKey().defaultRandom().$type<NotificationPreferenceId>(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    topic: messageTopic().notNull(),
    channel: messageChannel().notNull(),
    enabled: boolean().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("notification_preference_once").on(t.userId, t.topic, t.channel),
  ],
);

/**
 * A message an admin sent to the league, or an admin or captain sent to one
 * team. Each recipient gets a message row pointing back here.
 */
export const announcement = pgTable(
  "announcement",
  {
    id: uuid().primaryKey().defaultRandom().$type<AnnouncementId>(),
    authorId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    /** Null means the whole league for the season. */
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    subject: text().notNull(),
    body: text().notNull(),
    recipientCount: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("announcement_season_idx").on(t.seasonId, t.createdAt.desc()),
    index("announcement_author_idx").on(t.authorId, t.createdAt.desc()),
    check(
      "announcement_text_lengths",
      sql`char_length(${t.subject}) between 1 and 120 and char_length(${t.body}) between 1 and 5000`,
    ),
  ],
);

export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;
