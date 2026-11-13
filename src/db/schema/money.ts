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
import type {
  PaymentId,
  PromoCodeId,
  PurchaseId,
  PurchaseItemId,
  RefundId,
  RegistrationId,
  SeasonId,
  TeamSeasonId,
  UserId,
  WebhookEventId,
} from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";
import { registration, teamSeason } from "./team";

/**
 * Money (docs/data-model.md, section 2.3). `purchase` is our record of what
 * was bought; `payment` mirrors what Stripe says happened. A purchase is
 * marked paid only by the Stripe webhook, never by the browser returning
 * from Checkout. League credit arrives in a later migration.
 */
export const purchaseStatus = pgEnum("purchase_status", [
  "open",
  "paid",
  "failed",
  "expired",
  "refunded",
  "partially_refunded",
]);

export const promoKind = pgEnum("promo_kind", ["percent", "amount"]);

/**
 * A code that takes a percentage or an amount off checkout for one season.
 * The app applies it itself (ADR 0010), so Stripe sees the discounted price.
 * Codes are stored upper case and are unique within a season.
 */
export const promoCode = pgTable(
  "promo_code",
  {
    id: uuid().primaryKey().defaultRandom().$type<PromoCodeId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    code: text().notNull(),
    kind: promoKind().notNull(),
    /** Whole percent for `percent`, cents for `amount`. */
    value: integer().notNull(),
    maxRedemptions: integer(),
    validUntil: timestamp({ withTimezone: true }),
    /** Set when an admin turns the code off; it stops working at once. */
    disabledAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("promo_code_season_code").on(t.seasonId, t.code),
    check("promo_code_upper", sql`${t.code} = upper(${t.code})`),
    check(
      "promo_code_value",
      sql`(${t.kind} = 'percent' and ${t.value} between 1 and 100) or (${t.kind} = 'amount' and ${t.value} > 0)`,
    ),
    check(
      "promo_code_max_redemptions",
      sql`${t.maxRedemptions} is null or ${t.maxRedemptions} > 0`,
    ),
  ],
);

export const purchase = pgTable(
  "purchase",
  {
    id: uuid().primaryKey().defaultRandom().$type<PurchaseId>(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    seasonId: uuid()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    status: purchaseStatus().notNull().default("open"),
    subtotalCents: integer().notNull(),
    discountCents: integer().notNull().default(0),
    creditAppliedCents: integer().notNull().default(0),
    totalCents: integer().notNull(),
    promoCodeId: uuid()
      .$type<PromoCodeId>()
      .references(() => promoCode.id, { onDelete: "restrict" }),
    stripeCheckoutSessionId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("purchase_checkout_session_unique").on(t.stripeCheckoutSessionId),
    index("purchase_user_idx").on(t.userId),
    index("purchase_promo_code_idx").on(t.promoCodeId),
    check(
      "purchase_amounts",
      sql`${t.subtotalCents} >= 0 and ${t.discountCents} >= 0 and ${t.creditAppliedCents} >= 0 and ${t.totalCents} = ${t.subtotalCents} - ${t.discountCents} - ${t.creditAppliedCents} and ${t.totalCents} >= 0`,
    ),
  ],
);

export const purchaseItemKind = pgEnum("purchase_item_kind", [
  "team_fee",
  "player_share",
  "player_fee",
  "free_agent_fee",
  "balance",
  "event_ticket",
  "merch",
]);

export const purchaseItem = pgTable(
  "purchase_item",
  {
    id: uuid().primaryKey().defaultRandom().$type<PurchaseItemId>(),
    purchaseId: uuid()
      .notNull()
      .$type<PurchaseId>()
      .references(() => purchase.id, { onDelete: "cascade" }),
    kind: purchaseItemKind().notNull(),
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    registrationId: uuid()
      .$type<RegistrationId>()
      .references(() => registration.id, { onDelete: "restrict" }),
    amountCents: integer().notNull(),
    description: text().notNull(),
  },
  (t) => [
    index("purchase_item_purchase_idx").on(t.purchaseId),
    index("purchase_item_registration_idx").on(t.registrationId),
    check("purchase_item_amount", sql`${t.amountCents} >= 0`),
  ],
);

export const paymentStatus = pgEnum("payment_status", [
  "succeeded",
  "failed",
  "disputed",
]);

export const paymentMethod = pgEnum("payment_method", [
  "stripe",
  "cash",
  "venmo",
  "other",
]);

/**
 * Money that arrived for a purchase. Stripe payments carry their
 * PaymentIntent; cash, Venmo and other payments made outside the app carry a
 * note and who recorded them, so the team still reaches its total.
 */
export const payment = pgTable(
  "payment",
  {
    id: uuid().primaryKey().defaultRandom().$type<PaymentId>(),
    purchaseId: uuid()
      .notNull()
      .$type<PurchaseId>()
      .references(() => purchase.id, { onDelete: "restrict" }),
    method: paymentMethod().notNull().default("stripe"),
    stripePaymentIntentId: text(),
    note: text(),
    recordedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    stripeChargeId: text(),
    amountCents: integer().notNull(),
    /**
     * How much has gone back. For Stripe payments the charge.refunded
     * webhook sets it from Stripe's own total; off-app refunds add to it.
     */
    refundedCents: integer().notNull().default(0),
    stripeFeeCents: integer(),
    status: paymentStatus().notNull(),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payment_payment_intent_unique").on(t.stripePaymentIntentId),
    index("payment_purchase_idx").on(t.purchaseId),
    // Stripe payments have a PaymentIntent and off-app ones do not. Who
    // recorded an off-app payment is set in code; it may later be nulled
    // when that account is deleted.
    check(
      "payment_method_fields",
      sql`(${t.method} = 'stripe') = (${t.stripePaymentIntentId} is not null)`,
    ),
    check(
      "payment_refunded_cents",
      sql`${t.refundedCents} >= 0 and ${t.refundedCents} <= ${t.amountCents}`,
    ),
  ],
);

/**
 * Money an admin sent back. A Stripe refund carries its Stripe id once
 * Stripe accepts it; the payment's refunded total follows from the
 * charge.refunded webhook. An off-app refund (cash or Venmo handed back) has
 * no Stripe id and counts at once.
 */
export const refund = pgTable(
  "refund",
  {
    id: uuid().primaryKey().defaultRandom().$type<RefundId>(),
    paymentId: uuid()
      .notNull()
      .$type<PaymentId>()
      .references(() => payment.id, { onDelete: "restrict" }),
    stripeRefundId: text(),
    amountCents: integer().notNull(),
    reason: text(),
    issuedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("refund_stripe_refund_unique").on(t.stripeRefundId),
    index("refund_payment_idx").on(t.paymentId),
    check("refund_amount", sql`${t.amountCents} > 0`),
  ],
);

export const webhookEventStatus = pgEnum("webhook_event_status", [
  "received",
  "processed",
  "failed",
]);

/** Every webhook, once: a duplicate delivery hits the unique key and stops. */
export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: uuid().primaryKey().defaultRandom().$type<WebhookEventId>(),
    provider: text().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    status: webhookEventStatus().notNull().default("received"),
    error: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [unique("webhook_event_once").on(t.provider, t.eventId)],
);

export type Purchase = typeof purchase.$inferSelect;
export type PurchaseItem = typeof purchaseItem.$inferSelect;
export type Payment = typeof payment.$inferSelect;
export type PromoCode = typeof promoCode.$inferSelect;
export type Refund = typeof refund.$inferSelect;
