import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  LeagueId,
  MerchImageId,
  MerchItemId,
  MerchOrderId,
  PurchaseId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { purchase } from "./money";
import { bytea } from "./social";
import { teamSeason } from "./team";

/**
 * Merch and replacement jersey orders (docs/data-model.md, section 2.3;
 * ADR 0035). A small catalog the league's admins keep; players order one
 * item in one size per checkout, paid through Stripe Checkout or league
 * credit like registration.
 */

/**
 * league: one design for everyone (a league shirt, a hat). team_jersey: a
 * replacement team jersey, made in the color of the buyer's team.
 */
export const merchKind = pgEnum("merch_kind", ["league", "team_jersey"]);

/** Shirt sizes as on the profile, plus one size for a hat or a koozie. */
export const merchSize = pgEnum("merch_size", [
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "xxl",
  "one_size",
]);

export const merchItem = pgTable(
  "merch_item",
  {
    id: uuid().primaryKey().defaultRandom().$type<MerchItemId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    kind: merchKind().notNull(),
    name: text().notNull(),
    description: text(),
    priceCents: integer().notNull(),
    /** For anyone registered in any season; null means everyone pays the price. */
    memberPriceCents: integer(),
    /**
     * Made to order (printed after the deadline): no stock limit. Otherwise
     * each size sells only what merch_item_size.stock says the league has.
     */
    madeToOrder: boolean().notNull().default(false),
    /** Batch orders close at this moment; null keeps the item open. */
    orderDeadline: timestamp({ withTimezone: true }),
    /** Hidden from the shop; its orders and photos stay. */
    hiddenAt: timestamp({ withTimezone: true }),
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
    index("merch_item_league_idx").on(t.leagueId),
    check("merch_item_name", sql`length(trim(${t.name})) between 1 and 80`),
    check(
      "merch_item_price",
      sql`${t.priceCents} between 50 and 50000 and (${t.memberPriceCents} is null or ${t.memberPriceCents} between 0 and ${t.priceCents})`,
    ),
  ],
);

/**
 * The sizes an item comes in. `stock` is how many the league has of that
 * size in all, sold or not; it is ignored for an item made to order.
 */
export const merchItemSize = pgTable(
  "merch_item_size",
  {
    itemId: uuid()
      .notNull()
      .$type<MerchItemId>()
      .references(() => merchItem.id, { onDelete: "cascade" }),
    size: merchSize().notNull(),
    stock: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.size] }),
    check("merch_item_size_stock", sql`${t.stock} between 0 and 10000`),
  ],
);

/**
 * A photo of an item, stored like the Instagram copies (ADR 0023): one
 * WebP at most 1000 px wide, its metadata dropped. A few per item, and a
 * cap on all of them (src/domain/merch/catalog.ts).
 */
export const merchImage = pgTable(
  "merch_image",
  {
    id: uuid().primaryKey().defaultRandom().$type<MerchImageId>(),
    itemId: uuid()
      .notNull()
      .$type<MerchItemId>()
      .references(() => merchItem.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    alt: text().notNull(),
    contentType: text().notNull(),
    bytes: bytea().notNull(),
    byteSize: integer().notNull(),
    /** Hex SHA-256 of the bytes; the address's version. */
    sha256: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("merch_image_position").on(t.itemId, t.position),
    check("merch_image_type", sql`${t.contentType} = 'image/webp'`),
    check(
      "merch_image_size",
      sql`${t.byteSize} = octet_length(${t.bytes}) and ${t.byteSize} between 1 and 2097152`,
    ),
    check("merch_image_alt", sql`length(trim(${t.alt})) between 1 and 200`),
  ],
);

/**
 * held: stock is held for an open checkout until held_until. paid: paid
 * through the webhook, or by credit that covered it. fulfilled: handed
 * out or shipped. refunded: the league gave the money back and the stock
 * returned. released: the checkout ended unpaid.
 */
export const merchOrderStatus = pgEnum("merch_order_status", [
  "held",
  "paid",
  "fulfilled",
  "refunded",
  "released",
]);

/** One item in one size, bought in one checkout. */
export const merchOrder = pgTable(
  "merch_order",
  {
    id: uuid().primaryKey().defaultRandom().$type<MerchOrderId>(),
    itemId: uuid()
      .notNull()
      .$type<MerchItemId>()
      .references(() => merchItem.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    purchaseId: uuid()
      .notNull()
      .$type<PurchaseId>()
      .references(() => purchase.id, { onDelete: "restrict" }),
    status: merchOrderStatus().notNull(),
    size: merchSize().notNull(),
    quantity: integer().notNull(),
    /** The price of one, before league credit: the member price or the full one. */
    unitPriceCents: integer().notNull(),
    /** A team jersey's team; its name and color are kept as ordered. */
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    teamName: text(),
    colorHex: text(),
    heldUntil: timestamp({ withTimezone: true }),
    fulfilledAt: timestamp({ withTimezone: true }),
    fulfilledBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("merch_order_purchase_unique").on(t.purchaseId),
    index("merch_order_item_status_idx").on(t.itemId, t.status),
    index("merch_order_user_idx").on(t.userId),
    check("merch_order_quantity", sql`${t.quantity} between 1 and 5`),
    check("merch_order_unit_price", sql`${t.unitPriceCents} >= 0`),
    check(
      "merch_order_held_until",
      sql`(${t.status} = 'held') = (${t.heldUntil} is not null)`,
    ),
    check(
      "merch_order_fulfilled",
      sql`${t.status} <> 'fulfilled' or ${t.fulfilledAt} is not null`,
    ),
    check(
      "merch_order_color_hex",
      sql`${t.colorHex} is null or ${t.colorHex} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);

export type MerchItem = typeof merchItem.$inferSelect;
export type MerchOrder = typeof merchOrder.$inferSelect;
