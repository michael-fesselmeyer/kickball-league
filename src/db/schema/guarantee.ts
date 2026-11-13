import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  PurchaseId,
  SavedPaymentMethodId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { purchase } from "./money";
import { teamSeason } from "./team";

/**
 * A captain's guarantee (docs/data-model.md, section 2.3): a card saved
 * through Stripe Checkout in setup mode, charged for the team's unpaid
 * balance at the payment deadline after a 72-hour warning (see the
 * captain-guarantee ADR in docs/adr). We keep Stripe's ids and what the
 * captain needs to recognise the card; the card number never reaches us.
 */
export const savedPaymentMethod = pgTable(
  "saved_payment_method",
  {
    id: uuid().primaryKey().defaultRandom().$type<SavedPaymentMethodId>(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    /** The team this card guarantees. */
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    stripeCustomerId: text().notNull(),
    stripePaymentMethodId: text().notNull(),
    /** The Checkout session that saved it, so a replayed event saves once. */
    stripeSetupSessionId: text().notNull(),
    brand: text(),
    last4: text(),
    /** The deadline the 72-hour warning was sent for, and when. */
    warnedForDeadline: timestamp({ withTimezone: true }),
    warnedAt: timestamp({ withTimezone: true }),
    /** The balance purchase the deadline charge created. */
    chargePurchaseId: uuid()
      .$type<PurchaseId>()
      .references(() => purchase.id, { onDelete: "restrict" }),
    removedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saved_payment_method_session_unique").on(
      t.stripeSetupSessionId,
    ),
    // One live guarantee per team; saving a new card retires the old one.
    uniqueIndex("saved_payment_method_one_per_team")
      .on(t.teamSeasonId)
      .where(sql`${t.removedAt} is null`),
    index("saved_payment_method_user_idx").on(t.userId),
    check(
      "saved_payment_method_warning",
      sql`(${t.warnedAt} is null) = (${t.warnedForDeadline} is null)`,
    ),
  ],
);

export type SavedPaymentMethod = typeof savedPaymentMethod.$inferSelect;
