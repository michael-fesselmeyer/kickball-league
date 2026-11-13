import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CreditEntryId,
  PurchaseId,
  ReferralId,
  RegistrationId,
  SeasonId,
  SeasonRebateId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { purchase } from "./money";
import { season } from "./season";
import { registration, teamSeason } from "./team";

/**
 * League credit (docs/data-model.md, section 2.3). The ledger is append-only:
 * a person's balance is the sum of their rows. Grants are positive; spending
 * at checkout is negative and tied to the purchase; a checkout that expires
 * or fails gives its credit back with a matching `released` row.
 */
export const creditReason = pgEnum("credit_reason", [
  "rainout_rebate",
  "referral",
  "goodwill",
  "spent",
  "released",
]);

/**
 * One pro-rata rebate for a team that lost too many games in a season. It
 * records the numbers it was worked out from, and each payer's share is a
 * credit row pointing back at it. A team gets one rebate per season.
 */
export const seasonRebate = pgTable(
  "season_rebate",
  {
    id: uuid().primaryKey().defaultRandom().$type<SeasonRebateId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    gamesCount: integer().notNull(),
    gamesLost: integer().notNull(),
    paidCents: integer().notNull(),
    rebateCents: integer().notNull(),
    issuedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("season_rebate_team_once").on(t.teamSeasonId),
    index("season_rebate_season_idx").on(t.seasonId),
    check(
      "season_rebate_numbers",
      sql`${t.gamesCount} > 0 and ${t.gamesLost} between 1 and ${t.gamesCount} and ${t.paidCents} >= 0 and ${t.rebateCents} > 0 and ${t.rebateCents} <= ${t.paidCents}`,
    ),
  ],
);

/** A person's referral link: /r/<code>. Made the first time they look for it. */
export const referralCode = pgTable("referral_code", {
  userId: uuid()
    .primaryKey()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "cascade" }),
  code: text().notNull().unique("referral_code_code_unique"),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const referralStatus = pgEnum("referral_status", [
  "pending",
  "credited",
]);

/**
 * A new player who arrived through someone's referral link and registered.
 * A person is referred once; the referrer is credited once, when the
 * referred player's registration is paid.
 */
export const referral = pgTable(
  "referral",
  {
    id: uuid().primaryKey().defaultRandom().$type<ReferralId>(),
    referrerUserId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    referredUserId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    registrationId: uuid()
      .notNull()
      .$type<RegistrationId>()
      .references(() => registration.id, { onDelete: "restrict" }),
    status: referralStatus().notNull().default("pending"),
    creditedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("referral_referred_once").on(t.referredUserId),
    index("referral_referrer_idx").on(t.referrerUserId),
    check("referral_not_self", sql`${t.referrerUserId} <> ${t.referredUserId}`),
    check(
      "referral_credited_has_time",
      sql`(${t.status} = 'credited') = (${t.creditedAt} is not null)`,
    ),
  ],
);

export const creditEntry = pgTable(
  "credit_entry",
  {
    id: uuid().primaryKey().defaultRandom().$type<CreditEntryId>(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    /** Positive grants credit; negative spends it. */
    deltaCents: integer().notNull(),
    reason: creditReason().notNull(),
    /** For `spent` and `released`: the checkout that used the credit. */
    purchaseId: uuid()
      .$type<PurchaseId>()
      .references(() => purchase.id, { onDelete: "restrict" }),
    rebateId: uuid()
      .$type<SeasonRebateId>()
      .references(() => seasonRebate.id, { onDelete: "restrict" }),
    referralId: uuid()
      .$type<ReferralId>()
      .references(() => referral.id, { onDelete: "restrict" }),
    note: text(),
    issuedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_entry_user_idx").on(t.userId, t.createdAt),
    // A checkout spends once and gives back at most once.
    uniqueIndex("credit_entry_purchase_reason_once")
      .on(t.purchaseId, t.reason)
      .where(sql`${t.purchaseId} is not null`),
    uniqueIndex("credit_entry_rebate_user_once")
      .on(t.rebateId, t.userId)
      .where(sql`${t.rebateId} is not null`),
    uniqueIndex("credit_entry_referral_once")
      .on(t.referralId)
      .where(sql`${t.referralId} is not null`),
    check(
      "credit_entry_sign",
      sql`(${t.reason} = 'spent' and ${t.deltaCents} < 0) or (${t.reason} <> 'spent' and ${t.deltaCents} > 0)`,
    ),
    check(
      "credit_entry_source",
      sql`(${t.reason} in ('spent', 'released')) = (${t.purchaseId} is not null) and (${t.reason} = 'rainout_rebate') = (${t.rebateId} is not null) and (${t.reason} = 'referral') = (${t.referralId} is not null)`,
    ),
  ],
);

export type CreditEntry = typeof creditEntry.$inferSelect;
export type SeasonRebate = typeof seasonRebate.$inferSelect;
export type Referral = typeof referral.$inferSelect;
