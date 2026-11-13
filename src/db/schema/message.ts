import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  smallint,
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
  PushSubscriptionId,
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
  "new_team",
  "discipline",
  "digest",
]);

/** Email and web push today; text arrives later behind the same outbox. */
export const messageChannel = pgEnum("message_channel", [
  "email",
  "sms",
  "push",
]);

/**
 * queued: waiting for send_after. sending: claimed by a worker until
 * locked_until. sent: the provider accepted it. failed: gave up after the
 * last attempt, or the message cannot be built. suppressed: not sent on
 * purpose (suppress_reason says why). held: a non-urgent message over the
 * person's daily cap, waiting for the digest due at send_after. digested:
 * went out inside the digest message digest_id.
 */
export const messageStatus = pgEnum("message_status", [
  "queued",
  "sending",
  "sent",
  "failed",
  "suppressed",
  "held",
  "digested",
]);

/** How often a person's held messages come together in one email. */
export const digestFrequency = pgEnum("digest_frequency", ["daily", "weekly"]);

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
    /** Set when the message went out inside a digest: the digest's row. */
    digestId: uuid()
      .$type<MessageId>()
      .references((): AnyPgColumn => message.id, { onDelete: "set null" }),
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
    // Not partial on status = 'held': a migration cannot use an enum value
    // it adds in the same transaction.
    index("message_status_send_after_idx").on(t.status, t.sendAfter),
    index("message_digest_idx").on(t.digestId),
    index("message_sent_today_idx")
      .on(t.userId, t.sentAt)
      .where(sql`${t.status} = 'sent'`),
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
 * A person's limits on non-urgent messages: the daily cap per channel,
 * how often held messages come as a digest, and quiet hours in the
 * league's time zone. No row means the defaults (3 a day, a daily digest,
 * quiet from 10 pm to 8 am). See src/domain/notifications/limits.ts.
 */
export const alertSetting = pgTable(
  "alert_setting",
  {
    userId: uuid()
      .primaryKey()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    dailyCap: smallint().notNull().default(3),
    digest: digestFrequency().notNull().default("daily"),
    /** Whole local hours; both null when quiet hours are off. */
    quietStartHour: smallint().default(22),
    quietEndHour: smallint().default(8),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("alert_setting_daily_cap", sql`${t.dailyCap} between 0 and 3`),
    check(
      "alert_setting_quiet_hours",
      sql`(${t.quietStartHour} is null and ${t.quietEndHour} is null) or (${t.quietStartHour} between 0 and 23 and ${t.quietEndHour} between 0 and 23 and ${t.quietStartHour} <> ${t.quietEndHour})`,
    ),
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

/**
 * One browser or installed app that agreed to receive web push for a
 * person. The endpoint is the push service's address for that device; the
 * keys encrypt each message so only the device can read it. A person may
 * have several devices. A push service that answers 404 or 410 has dropped
 * the subscription, and the outbox deletes the row. See
 * docs/architecture.md, section 14 ("Push notifications").
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid().primaryKey().defaultRandom().$type<PushSubscriptionId>(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text().notNull(),
    /** The device's P-256 public key, base64url. */
    p256dh: text().notNull(),
    /** The device's 16-byte authentication secret, base64url. */
    auth: text().notNull(),
    /** The browser that subscribed, so the person can tell devices apart. */
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("push_subscription_endpoint_unique").on(t.endpoint),
    index("push_subscription_user_idx").on(t.userId),
    check(
      "push_subscription_endpoint_https",
      sql`${t.endpoint} like 'https://%' and char_length(${t.endpoint}) <= 2048`,
    ),
    check(
      "push_subscription_key_lengths",
      sql`char_length(${t.p256dh}) between 80 and 100 and char_length(${t.auth}) between 16 and 32`,
    ),
  ],
);

export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;
