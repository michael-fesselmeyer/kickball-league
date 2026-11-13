import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  GameId,
  GameLineupId,
  GameLineupSpotId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { game } from "./game";
import { teamSeason } from "./team";

/**
 * A team's saved kicking order for one game (rulebook 2.2.4; ADR 0021).
 * Saving again replaces its spots. Players' lineup genders are never copied
 * here: they are read from the profile (or the sub claim, for a pickup)
 * when the order is shown to the team's captains.
 */
export const gameLineup = pgTable(
  "game_lineup",
  {
    id: uuid().primaryKey().defaultRandom().$type<GameLineupId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    /** Rule breaks when it was saved, for the ref and the other captain. */
    runBreaks: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** Who saved it last. */
    updatedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("game_lineup_once").on(t.gameId, t.teamSeasonId),
    index("game_lineup_team_idx").on(t.teamSeasonId),
    check("game_lineup_run_breaks", sql`${t.runBreaks} >= 0`),
  ],
);

/** One kicker's place in a saved order, from 1. */
export const gameLineupSpot = pgTable(
  "game_lineup_spot",
  {
    id: uuid().primaryKey().defaultRandom().$type<GameLineupSpotId>(),
    lineupId: uuid()
      .notNull()
      .$type<GameLineupId>()
      .references(() => gameLineup.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    /** An approved sub from outside the roster, who kicks last. */
    pickup: boolean().notNull().default(false),
  },
  (t) => [
    unique("game_lineup_spot_position").on(t.lineupId, t.position),
    unique("game_lineup_spot_once").on(t.lineupId, t.userId),
    index("game_lineup_spot_user_idx").on(t.userId),
    check(
      "game_lineup_spot_position_range",
      sql`${t.position} between 1 and 40`,
    ),
  ],
);

export type GameLineup = typeof gameLineup.$inferSelect;
export type GameLineupSpot = typeof gameLineupSpot.$inferSelect;
