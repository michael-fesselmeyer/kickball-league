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
  BracketId,
  DivisionId,
  BracketMatchId,
  GameId,
  ScheduleVersionId,
  SeasonId,
  SlotId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import type { MatchSource } from "@/domain/playoffs/playoffs";
import { user } from "./auth";
import { division } from "./division";
import { game, slot } from "./game";
import { scheduleVersion } from "./schedule";
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

export const bracketFormat = pgEnum("bracket_format", ["single_elimination"]);
export const bracketStatus = pgEnum("bracket_status", [
  "draft",
  "published",
  "complete",
]);

/** One seed: its number and the team entry, frozen when the bracket was made. */
export type BracketSeed = { seed: number; teamSeasonId: string };

/**
 * A season's playoff bracket (docs/data-model.md, section 2.2). Seeds are
 * frozen from the standings when an admin makes it; schedule_version_id is
 * the version that first placed it on fields.
 */
export const bracket = pgTable(
  "bracket",
  {
    id: uuid().primaryKey().defaultRandom().$type<BracketId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    /**
     * The division this bracket crowns. Null for the season's only bracket,
     * which with two divisions seeds each into its own half (ADR 0040).
     */
    divisionId: uuid()
      .$type<DivisionId>()
      .references(() => division.id, { onDelete: "restrict" }),
    format: bracketFormat().notNull().default("single_elimination"),
    status: bracketStatus().notNull().default("draft"),
    /** Teams in the bracket; byes fill it to the next power of two. */
    size: integer().notNull(),
    seeds: jsonb().$type<BracketSeed[]>().notNull(),
    scheduleVersionId: uuid()
      .$type<ScheduleVersionId>()
      .references(() => scheduleVersion.id, { onDelete: "set null" }),
    championId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    /** placeBracket's notes, such as a round spilling to another date. */
    diagnostics: jsonb().$type<string[]>().notNull().default([]),
    ...audit(),
  },
  (t) => [
    unique("bracket_season_division_unique")
      .on(t.seasonId, t.divisionId)
      .nullsNotDistinct(),
    check("bracket_size_range", sql`${t.size} between 2 and 32`),
    check(
      "bracket_complete_has_champion",
      sql`(${t.status} = 'complete') = (${t.championId} is not null)`,
    ),
  ],
);

/**
 * One match in a bracket. Its teams fill in as earlier matches finish;
 * game_id is set once both are known and the game is on the schedule.
 * slot_id is the slot the bracket placement reserved for it.
 */
export const bracketMatch = pgTable(
  "bracket_match",
  {
    id: uuid().primaryKey().defaultRandom().$type<BracketMatchId>(),
    bracketId: uuid()
      .notNull()
      .$type<BracketId>()
      .references(() => bracket.id, { onDelete: "cascade" }),
    /** `r{round}m{position}`, stable for the bracket's life. */
    code: text().notNull(),
    roundNo: integer().notNull(),
    position: integer().notNull(),
    sourceA: jsonb().$type<MatchSource>().notNull(),
    sourceB: jsonb().$type<MatchSource>().notNull(),
    teamAId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    teamBId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    slotId: uuid()
      .$type<SlotId>()
      .references(() => slot.id, { onDelete: "set null" }),
    gameId: uuid()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "set null" }),
    winnerId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
  },
  (t) => [
    unique("bracket_match_code_unique").on(t.bracketId, t.code),
    unique("bracket_match_game_unique").on(t.gameId),
    index("bracket_match_bracket_idx").on(t.bracketId, t.roundNo),
    check("bracket_match_round_positive", sql`${t.roundNo} > 0`),
    check("bracket_match_position_positive", sql`${t.position} > 0`),
    check(
      "bracket_match_winner_plays",
      sql`${t.winnerId} is null or ${t.winnerId} in (${t.teamAId}, ${t.teamBId})`,
    ),
  ],
);

export type Bracket = typeof bracket.$inferSelect;
export type BracketMatch = typeof bracketMatch.$inferSelect;
