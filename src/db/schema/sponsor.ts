import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CheckinId,
  DealId,
  DealRedemptionId,
  LeagueId,
  SeasonId,
  SponsorId,
  SponsorMemberId,
  TeamOfWeekId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";
import { teamSeason } from "./team";

const audit = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "set null" }),
});

export const sponsorKind = pgEnum("sponsor_kind", [
  "bar",
  "restaurant",
  "brand",
  "other",
]);

/**
 * A business that backs the league (docs/data-model.md, section 2.5). The
 * home bar is where players go after games. checkin_secret signs the
 * rotating check-in code and never leaves the server. Sponsors are hidden
 * with deleted_at, never deleted, so their check-ins stay counted.
 */
export const sponsor = pgTable(
  "sponsor",
  {
    id: uuid().primaryKey().defaultRandom().$type<SponsorId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull(),
    kind: sponsorKind().notNull().default("bar"),
    isHomeBar: boolean().notNull().default(false),
    blurb: text(),
    address: text(),
    url: text(),
    checkinSecret: text().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
    ...audit(),
  },
  (t) => [
    unique("sponsor_league_slug_unique").on(t.leagueId, t.slug),
    // One home bar at a time.
    uniqueIndex("sponsor_one_home_bar")
      .on(t.leagueId)
      .where(sql`${t.isHomeBar} and ${t.deletedAt} is null`),
    check("sponsor_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("sponsor_name_length", sql`char_length(${t.name}) between 1 and 80`),
    check(
      "sponsor_blurb_length",
      sql`${t.blurb} is null or char_length(${t.blurb}) <= 500`,
    ),
    check("sponsor_url_https", sql`${t.url} is null or ${t.url} ~ '^https://'`),
    check(
      "sponsor_checkin_secret_length",
      sql`char_length(${t.checkinSecret}) >= 32`,
    ),
  ],
);

/** A person who manages a sponsor's page and reads its report. */
export const sponsorMember = pgTable(
  "sponsor_member",
  {
    id: uuid().primaryKey().defaultRandom().$type<SponsorMemberId>(),
    sponsorId: uuid()
      .notNull()
      .$type<SponsorId>()
      .references(() => sponsor.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("sponsor_member_unique").on(t.sponsorId, t.userId),
    index("sponsor_member_user_idx").on(t.userId),
  ],
);

/**
 * A standing offer, such as "$2 off any burger after a game". valid_days are
 * ISO weekdays (1 Monday to 7 Sunday); empty means every day. The times
 * bound it within the day in the league's time zone; both null means all
 * day. confirmed_at is when the sponsor last said it is still current.
 * Deals are turned off, never deleted, so redemptions keep their deal.
 */
export const deal = pgTable(
  "deal",
  {
    id: uuid().primaryKey().defaultRandom().$type<DealId>(),
    sponsorId: uuid()
      .notNull()
      .$type<SponsorId>()
      .references(() => sponsor.id, { onDelete: "cascade" }),
    title: text().notNull(),
    terms: text(),
    validDays: smallint()
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    validFrom: time(),
    validTo: time(),
    active: boolean().notNull().default(true),
    confirmedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...audit(),
  },
  (t) => [
    index("deal_sponsor_idx").on(t.sponsorId),
    check("deal_title_length", sql`char_length(${t.title}) between 1 and 80`),
    check(
      "deal_terms_length",
      sql`${t.terms} is null or char_length(${t.terms}) <= 300`,
    ),
    check(
      "deal_valid_days_range",
      sql`${t.validDays} <@ '{1,2,3,4,5,6,7}'::smallint[]`,
    ),
    check(
      "deal_valid_times_paired",
      sql`(${t.validFrom} is null) = (${t.validTo} is null)`,
    ),
  ],
);

/**
 * A player at a sponsor on a day, from scanning its rotating code.
 * team_season_id is the team they played for that season, when they had
 * one, so the report can say which teams came in.
 */
export const checkin = pgTable(
  "checkin",
  {
    id: uuid().primaryKey().defaultRandom().$type<CheckinId>(),
    sponsorId: uuid()
      .notNull()
      .$type<SponsorId>()
      .references(() => sponsor.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "set null" }),
    /** The day in the league's time zone. */
    onDate: date().notNull(),
    checkedInAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("checkin_once_a_day").on(t.sponsorId, t.userId, t.onDate),
    index("checkin_sponsor_date_idx").on(t.sponsorId, t.onDate),
    index("checkin_user_idx").on(t.userId),
  ],
);

/** A deal used on a check-in: once per deal per visit. */
export const dealRedemption = pgTable(
  "deal_redemption",
  {
    id: uuid().primaryKey().defaultRandom().$type<DealRedemptionId>(),
    dealId: uuid()
      .notNull()
      .$type<DealId>()
      .references(() => deal.id, { onDelete: "cascade" }),
    checkinId: uuid()
      .notNull()
      .$type<CheckinId>()
      .references(() => checkin.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    redeemedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("deal_redemption_once_a_visit").on(t.dealId, t.checkinId),
    index("deal_redemption_checkin_idx").on(t.checkinId),
  ],
);

/**
 * The team an admin names for a game day, with an optional tab at a
 * sponsor. week_of is the game day the honor is for.
 */
export const teamOfWeek = pgTable(
  "team_of_week",
  {
    id: uuid().primaryKey().defaultRandom().$type<TeamOfWeekId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    weekOf: date().notNull(),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    // Sponsors are hidden, never deleted, so a tab keeps its sponsor.
    sponsorId: uuid()
      .$type<SponsorId>()
      .references(() => sponsor.id, { onDelete: "restrict" }),
    tabCents: integer(),
    reason: text().notNull(),
    ...audit(),
  },
  (t) => [
    unique("team_of_week_one_a_day").on(t.seasonId, t.weekOf),
    check(
      "team_of_week_tab_range",
      sql`${t.tabCents} is null or ${t.tabCents} between 1 and 100000`,
    ),
    check(
      "team_of_week_reason_length",
      sql`char_length(${t.reason}) between 1 and 280`,
    ),
    check(
      "team_of_week_tab_needs_sponsor",
      sql`${t.tabCents} is null or ${t.sponsorId} is not null`,
    ),
  ],
);
