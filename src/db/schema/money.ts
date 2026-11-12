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
  PurchaseId,
  PurchaseItemId,
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
 * from Checkout. Promo codes, credit and refunds arrive in later migrations.
 */
export const purchaseStatus = pgEnum("purchase_status", [
  "open",
  "paid",
  "failed",
  "expired",
  "refunded",
  "partially_refunded",
]);

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
