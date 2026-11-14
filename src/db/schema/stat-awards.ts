import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  MvpPart,
  MvpWeights,
  StatAward,
} from "@/domain/awards/stat-awards";
import type {
  SeasonId,
  StatAwardPlaceId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";
import { teamSeason } from "./team";

/** The stat awards (src/domain/awards/stat-awards.ts, ADR 0046). */
export const statAwardKind = pgEnum("stat_award_kind", [
  "season_mvp",
  "iron_kicker",
  "golden_boot",
  "best_teammate",
  "rookie_of_the_year",
  "sub_of_the_year",
]);

/**
 * A season's stat awards (docs/data-model.md, section 2.5): the MVP weights
 * they were worked out with, when, and admins' notes. Admins see them as
 * soon as they are computed; the public awards page shows them only once
 * published_at is set. Computing again replaces the places.
 */
export const statAwardSet = pgTable(
  "stat_award_set",
  {
    seasonId: uuid()
      .primaryKey()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    weights: jsonb().$type<MvpWeights>().notNull(),
    /** MVP parts nobody had data for, so no score used them. */
    unusedParts: text()
      .array()
      .$type<MvpPart[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Whether a closed season MVP poll's votes were in the MVP score. */
    votesCounted: boolean().notNull().default(false),
    /** An admin's note on each award, shown under it on the awards page. */
    notes: jsonb()
      .$type<Partial<Record<StatAward, string>>>()
      .notNull()
      .default({}),
    computedAt: timestamp({ withTimezone: true }).notNull(),
    computedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "stat_award_set_published_after_computed",
      sql`${t.publishedAt} is null or ${t.publishedAt} >= ${t.computedAt}`,
    ),
  ],
);

/** The numbers behind a place, printed beside it on the awards page. */
export type StatAwardDetail = {
  /** Games the stat was based on, and out of how many. */
  recorded?: number;
  of?: number;
  /** For the MVP and Rookie of the Year: each part's raw number. */
  parts?: Record<MvpPart, number | null>;
};

/**
 * One person on a stat award's leaderboard. Place 1 is the winner; tied
 * people share a place, so an award can have several winners.
 */
export const statAwardPlace = pgTable(
  "stat_award_place",
  {
    id: uuid().primaryKey().defaultRandom().$type<StatAwardPlaceId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => statAwardSet.seasonId, { onDelete: "cascade" }),
    award: statAwardKind().notNull(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The team they played for that season, for the awards page. */
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "set null" }),
    place: smallint().notNull(),
    value: doublePrecision().notNull(),
    detail: jsonb().$type<StatAwardDetail>().notNull().default({}),
  },
  (t) => [
    unique("stat_award_place_once").on(t.seasonId, t.award, t.userId),
    index("stat_award_place_user_idx").on(t.userId),
    check("stat_award_place_range", sql`${t.place} between 1 and 99`),
  ],
);

/**
 * A player who asked to stay off public stat leaderboards. They are left
 * out when awards are computed, and the awards page never lists them.
 */
export const leaderboardOptOut = pgTable("leaderboard_opt_out", {
  userId: uuid()
    .primaryKey()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type StatAwardSet = typeof statAwardSet.$inferSelect;
export type StatAwardPlace = typeof statAwardPlace.$inferSelect;
