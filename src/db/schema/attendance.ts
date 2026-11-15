import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { GameId, TeamSeasonId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { game } from "./game";
import { teamSeason } from "./team";

/** How a player came to be on a game's attendance: they scanned, or were ticked. */
export const attendanceMethod = pgEnum("attendance_method", ["scan", "marked"]);

/**
 * Who played in a game, for the team they played for (docs/data-model.md,
 * section 2.4; ADR 0063). A player scans the game's rotating code at the
 * field, or a captain, the ref or an admin ticks them in. Subs and pickups
 * approved for the game count for the team they played for. One row per
 * player per game. Games played are counted from these rows, never stored.
 */
export const gameAttendance = pgTable(
  "game_attendance",
  {
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    method: attendanceMethod().notNull(),
    /** Who ticked them in; the player themselves for a scan. */
    recordedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.userId] }),
    index("game_attendance_user_idx").on(t.userId),
    index("game_attendance_team_idx").on(t.teamSeasonId, t.gameId),
    index("game_attendance_recorded_by_idx").on(t.recordedBy),
  ],
);

export type GameAttendance = typeof gameAttendance.$inferSelect;
export type AttendanceMethod = (typeof attendanceMethod.enumValues)[number];
