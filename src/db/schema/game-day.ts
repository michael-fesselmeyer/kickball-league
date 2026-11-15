import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GameDayStatusId, GameId, SeasonId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { game } from "./game";
import { season } from "./season";

/** On, watching the weather, some games late, or some or all games off. */
export const gameDayState = pgEnum("game_day_state", [
  "on",
  "watching",
  "delayed",
  "off",
]);

/**
 * A season's status for one game day (issue #383), shown on the public
 * schedule, the game pages and players' home screens. One row per season
 * and date, replaced as an admin changes it; each change is audited. See
 * docs/data-model.md, section 2.2.
 */
export const gameDayStatus = pgTable(
  "game_day_status",
  {
    id: uuid().primaryKey().defaultRandom().$type<GameDayStatusId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    /** The game day, YYYY-MM-DD in the league's time zone. */
    date: date({ mode: "string" }).notNull(),
    state: gameDayState().notNull(),
    /** Watching only: when the league will decide. */
    decideBy: timestamp({ withTimezone: true }),
    /** "Field flooded", "no lights". */
    reason: text(),
    setBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    setAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("game_day_status_season_date").on(t.seasonId, t.date),
    check(
      "game_day_status_decide_by",
      sql`(${t.state} = 'watching') = (${t.decideBy} is not null)`,
    ),
    check(
      "game_day_status_reason_length",
      sql`${t.reason} is null or char_length(${t.reason}) between 1 and 120`,
    ),
    index("game_day_status_set_by_idx").on(t.setBy),
  ],
);

/**
 * The games a Delayed or Off status touches, with a delayed game's new
 * start. Replaced with the status.
 */
export const gameDayStatusGame = pgTable(
  "game_day_status_game",
  {
    statusId: uuid()
      .notNull()
      .$type<GameDayStatusId>()
      .references(() => gameDayStatus.id, { onDelete: "cascade" }),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    /** Delayed only: when the game starts now. */
    newStartsAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.statusId, t.gameId] }),
    index("game_day_status_game_game_idx").on(t.gameId),
  ],
);
