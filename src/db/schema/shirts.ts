import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ExpenseId, SeasonId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { expense } from "./books";
import { profileShirtSize } from "./profile";
import { season } from "./season";

/**
 * placed: the league sent the order to its vendor. received: the shirts
 * arrived. A season with no row has the default sizes and no order yet.
 */
export const shirtOrderStatus = pgEnum("shirt_order_status", [
  "not_placed",
  "placed",
  "received",
]);

/**
 * A season's shirts (docs/data-model.md, section 2.1): the sizes players
 * pick from at sign-up, and the order the league places for them.
 */
export const seasonShirts = pgTable(
  "season_shirts",
  {
    seasonId: uuid()
      .primaryKey()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    /** The sizes offered this season, smallest first. */
    sizes: profileShirtSize()
      .array()
      .notNull()
      .default(sql`'{xs,s,m,l,xl,xxl}'::profile_shirt_size[]`),
    status: shirtOrderStatus().notNull().default("not_placed"),
    placedAt: timestamp({ withTimezone: true }),
    receivedAt: timestamp({ withTimezone: true }),
    /** What the vendor charged, for the books. */
    costCents: integer(),
    vendor: text(),
    /** The books expense made from this order, so it is added once. */
    expenseId: uuid()
      .$type<ExpenseId>()
      .references(() => expense.id, { onDelete: "set null" }),
    updatedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("season_shirts_expense").on(t.expenseId),
    check("season_shirts_sizes", sql`cardinality(${t.sizes}) >= 1`),
    check(
      "season_shirts_cost",
      sql`${t.costCents} is null or ${t.costCents} between 1 and 10000000`,
    ),
    check(
      "season_shirts_vendor",
      sql`${t.vendor} is null or length(${t.vendor}) <= 80`,
    ),
    check(
      "season_shirts_status",
      sql`(${t.status} = 'not_placed') = (${t.placedAt} is null) and (${t.status} = 'received') = (${t.receivedAt} is not null)`,
    ),
  ],
);

export type SeasonShirts = typeof seasonShirts.$inferSelect;
