import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ExpenseId,
  LeagueId,
  RefereePayoutId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { MAX_PAY_CENTS, PAYOUT_METHODS } from "@/domain/referees/pay";
import { user } from "./auth";
import { expense } from "./books";
import { league } from "./league";
import { season } from "./season";

/**
 * The ref pool, availability and pay (docs/data-model.md, section 2.6;
 * ADR 0053). Who refs a game stays in `referee_assignment` (game.ts), which
 * the game pages and the command center read.
 */

/** Someone admins can assign as a ref. Being in the pool makes them a ref. */
export const refereeProfile = pgTable(
  "referee_profile",
  {
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    addedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.leagueId, t.userId] }),
    index("referee_profile_user_idx").on(t.userId),
    index("referee_profile_added_by_idx").on(t.addedBy),
  ],
);

/**
 * A slot time a ref said they can work in a season: one row per start
 * time, whichever field the game is on. No row means they can't.
 */
export const refereeAvailability = pgTable(
  "referee_availability",
  {
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId, t.startsAt] }),
    index("referee_availability_user_idx").on(t.userId),
  ],
);

/** A season's per-game ref fee. No row means none is set yet. */
export const refereePayRate = pgTable(
  "referee_pay_rate",
  {
    seasonId: uuid()
      .primaryKey()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    feeCents: integer().notNull(),
    updatedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("referee_pay_rate_updated_by_idx").on(t.updatedBy),
    check(
      "referee_pay_rate_fee",
      sql`${t.feeCents} between 0 and ${sql.raw(String(MAX_PAY_CENTS))}`,
    ),
  ],
);

export const refereePayoutMethod = pgEnum(
  "referee_payout_method",
  PAYOUT_METHODS,
);

/**
 * Money paid to a ref, marked by an owner or admin. Recording one also adds
 * a "Refs" expense to the season's books, linked here.
 */
export const refereePayout = pgTable(
  "referee_payout",
  {
    id: uuid().primaryKey().defaultRandom().$type<RefereePayoutId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    amountCents: integer().notNull(),
    method: refereePayoutMethod().notNull(),
    paidOn: date({ mode: "string" }).notNull(),
    paidBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    expenseId: uuid()
      .$type<ExpenseId>()
      .references(() => expense.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("referee_payout_season_user_idx").on(t.seasonId, t.userId),
    index("referee_payout_user_idx").on(t.userId),
    index("referee_payout_paid_by_idx").on(t.paidBy),
    index("referee_payout_expense_idx").on(t.expenseId),
    check(
      "referee_payout_amount",
      sql`${t.amountCents} between 1 and ${sql.raw(String(MAX_PAY_CENTS))}`,
    ),
  ],
);
