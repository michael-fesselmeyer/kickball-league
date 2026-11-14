import { index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type {
  GameId,
  PickemPickId,
  SlotId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { game, slot } from "./game";
import { teamSeason } from "./team";

/**
 * One player's predicted winner for one game (docs/data-model.md, section
 * 2.5; ADR 0044). Bragging rights only: nothing here holds money, a fee or
 * a prize. A pick can change until the game starts. slot_id is the slot the
 * game was in when the pick was made: if the game moves (a rain-out) or the
 * slot goes, the pick is void. Scores are never stored; they are read from
 * the game's confirmed result (src/domain/pickem/pickem.ts).
 */
export const pickemPick = pgTable(
  "pickem_pick",
  {
    id: uuid().primaryKey().defaultRandom().$type<PickemPickId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The team picked to win. */
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    slotId: uuid()
      .$type<SlotId>()
      .references(() => slot.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("pickem_pick_once").on(t.gameId, t.userId),
    index("pickem_pick_user_idx").on(t.userId),
  ],
);

/**
 * A player who chose to stay off the pick'em leaderboards. One row per
 * person; no row means they are shown. Their own record still shows to them.
 */
export const pickemHidden = pgTable("pickem_hidden", {
  userId: uuid()
    .primaryKey()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type PickemPick = typeof pickemPick.$inferSelect;
