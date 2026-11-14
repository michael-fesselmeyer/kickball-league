import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { LeagueId, SeasonId, UserId, WaiverId } from "@/domain/ids";
import type { Tiebreaker } from "@/domain/standings/standings";
import { user } from "./auth";
import { league } from "./league";
import { waiver } from "./waiver";

export const seasonStatus = pgEnum("season_status", [
  "draft",
  "registration_open",
  "registration_closed",
  "in_progress",
  "playoffs",
  "completed",
]);

export const seasonFeeModel = pgEnum("season_fee_model", [
  "per_team",
  "per_player",
]);

/** Shapes of the season's rule settings; validated with Zod where an admin edits them. */
export type FieldingRules = {
  maxFielders?: number;
  maxPerGender?: number;
  minimumToPlay?: number;
  minimumOwnPlayers?: number;
};
export type { Tiebreaker } from "@/domain/standings/standings";
export type RebatePolicy = {
  thresholdPct?: number;
  method?: "credit" | "refund";
};

/**
 * A season of play: dates, registration windows, pricing and roster limits.
 * See docs/data-model.md, section 2.1. default_rule_set_id arrives with
 * the rule-set table.
 */
export const season = pgTable(
  "season",
  {
    id: uuid().primaryKey().defaultRandom().$type<SeasonId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull(),
    status: seasonStatus().notNull().default("draft"),
    startsOn: date({ mode: "string" }).notNull(),
    endsOn: date({ mode: "string" }).notNull(),
    registrationOpensAt: timestamp({ withTimezone: true }),
    registrationClosesAt: timestamp({ withTimezone: true }),
    paymentDeadlineAt: timestamp({ withTimezone: true }),
    feeModel: seasonFeeModel().notNull(),
    teamFeeCents: integer(),
    playerFeeCents: integer(),
    freeAgentFeeCents: integer(),
    earlyBirdEndsAt: timestamp({ withTimezone: true }),
    earlyBirdDiscountCents: integer(),
    maxTeams: integer(),
    rosterMin: integer().notNull(),
    rosterMax: integer().notNull(),
    gamesPerTeamPerDay: integer().notNull().default(1),
    /** The waiver version players sign for this season. */
    waiverId: uuid()
      .$type<WaiverId>()
      .references((): AnyPgColumn => waiver.id, { onDelete: "restrict" }),
    fieldingRules: jsonb().$type<FieldingRules>().notNull().default({}),
    tiebreakers: jsonb()
      .$type<Tiebreaker[]>()
      .notNull()
      .default([
        "win_pct",
        "head_to_head",
        "run_difference",
        "runs_allowed",
        "coin_flip",
      ]),
    rebatePolicy: jsonb().$type<RebatePolicy>().notNull().default({}),
    /** Games each team plays against the other division (ADR 0040). */
    crossoverGames: integer().notNull().default(0),
    /** Whether crossover results count in division standings. */
    crossoversCount: boolean().notNull().default(true),
    /** With two divisions, whether their playoff champions meet in a final. */
    combinedFinal: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("season_league_slug_unique").on(t.leagueId, t.slug),
    index("season_league_starts_idx").on(t.leagueId, t.startsOn),
    check("season_dates_order", sql`${t.endsOn} >= ${t.startsOn}`),
    check(
      "season_roster_limits",
      sql`${t.rosterMin} > 0 and ${t.rosterMax} >= ${t.rosterMin}`,
    ),
    check("season_games_per_day", sql`${t.gamesPerTeamPerDay} in (1, 2)`),
    check(
      "season_crossover_games_range",
      sql`${t.crossoverGames} between 0 and 10`,
    ),
    check(
      "season_fees_non_negative",
      sql`coalesce(${t.teamFeeCents}, 0) >= 0 and coalesce(${t.playerFeeCents}, 0) >= 0 and coalesce(${t.freeAgentFeeCents}, 0) >= 0 and coalesce(${t.earlyBirdDiscountCents}, 0) >= 0`,
    ),
    check(
      "season_fee_matches_model",
      sql`(${t.feeModel} = 'per_team' and ${t.teamFeeCents} is not null) or (${t.feeModel} = 'per_player' and ${t.playerFeeCents} is not null)`,
    ),
    check(
      "season_registration_window",
      sql`${t.registrationClosesAt} is null or ${t.registrationOpensAt} is null or ${t.registrationClosesAt} > ${t.registrationOpensAt}`,
    ),
  ],
);

export type Season = typeof season.$inferSelect;
export type NewSeason = typeof season.$inferInsert;
