import { sql } from "drizzle-orm";
import {
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
import type { MessageId, UserId } from "@/domain/ids";
import { user } from "./auth";

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
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("message_dedupe_key_unique").on(t.dedupeKey),
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

export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;
