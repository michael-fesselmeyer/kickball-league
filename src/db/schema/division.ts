import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  DivisionId,
  LeagueId,
  RuleSetId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";

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

/** Optional rule switches a rule set can turn on or off. */
export type RuleSetOptions = {
  bunting?: boolean;
  stealing?: boolean;
  /** What happens when a game reaches the end of its permit (#406). */
  permitEndRule?: "call_at_last_complete" | "last_inning_to_start";
  /** Minutes before the time limit after which no new inning starts; 10 when unset. */
  noNewInningMinutes?: number;
  /**
   * Minutes before sunset that play must end on a field without lights
   * (#467). Unset means the default in src/domain/gameday/daylight.ts.
   */
  daylightMarginMinutes?: number;
};

/**
 * A named set of game rules a league can give a division, for example a
 * Competitive set with seven innings and a Social set with five. See
 * docs/data-model.md, section 2.1.
 */
export const ruleSet = pgTable(
  "rule_set",
  {
    id: uuid().primaryKey().defaultRandom().$type<RuleSetId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    name: text().notNull(),
    innings: integer(),
    /**
     * Sets in a match, for a sport played in sets such as dodgeball (ADR
     * 0087): best of this many. Null uses the sport's default.
     */
    bestOf: smallint(),
    timeLimitMinutes: integer(),
    options: jsonb().$type<RuleSetOptions>().notNull().default({}),
    ...audit(),
  },
  (t) => [
    unique("rule_set_league_name_unique").on(t.leagueId, t.name),
    check(
      "rule_set_innings_range",
      sql`${t.innings} is null or ${t.innings} between 1 and 15`,
    ),
    check(
      "rule_set_best_of",
      sql`${t.bestOf} is null or (${t.bestOf} between 1 and 9 and ${t.bestOf} % 2 = 1)`,
    ),
    check(
      "rule_set_time_limit_range",
      sql`${t.timeLimitMinutes} is null or ${t.timeLimitMinutes} between 10 and 240`,
    ),
  ],
);

/**
 * A group of teams within a season that play their own round robin and
 * standings, for example Competitive and Social. A season with none plays
 * as one pool. Teams join one through team_season.division_id.
 */
export const division = pgTable(
  "division",
  {
    id: uuid().primaryKey().defaultRandom().$type<DivisionId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull(),
    ruleSetId: uuid()
      .$type<RuleSetId>()
      .references(() => ruleSet.id, { onDelete: "set null" }),
    sortOrder: integer().notNull().default(0),
    ...audit(),
  },
  (t) => [
    unique("division_season_slug_unique").on(t.seasonId, t.slug),
    unique("division_season_name_unique").on(t.seasonId, t.name),
    // The target of team_season's (division_id, season_id) key, which keeps
    // a team in a division of its own season.
    unique("division_id_season_unique").on(t.id, t.seasonId),
    index("division_season_order_idx").on(t.seasonId, t.sortOrder),
    check("division_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export type RuleSet = typeof ruleSet.$inferSelect;
export type Division = typeof division.$inferSelect;
