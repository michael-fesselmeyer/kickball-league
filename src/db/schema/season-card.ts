import {
  boolean,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { SeasonId, SeasonCardId, UserId } from "@/domain/ids";
import type { SeasonCardStats } from "@/domain/season-card/card";
import { user } from "./auth";
import { season } from "./season";

/**
 * "Your season in kickball": one player's end-of-season card
 * (docs/data-model.md, section 2.5). An admin creates the cards once the
 * season is completed; the numbers are stored, so the card reads the same
 * whenever it is opened. Private until the player makes its link public;
 * the id is the link, so it cannot be guessed.
 */
export const seasonCard = pgTable(
  "season_card",
  {
    id: uuid().primaryKey().defaultRandom().$type<SeasonCardId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    stats: jsonb().$type<SeasonCardStats>().notNull(),
    /** The player chose to make the card's link public. */
    isPublic: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** When an admin last built or refreshed the numbers. */
    builtAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("season_card_once").on(t.seasonId, t.userId),
    index("season_card_user_idx").on(t.userId),
  ],
);

export type SeasonCard = typeof seasonCard.$inferSelect;
