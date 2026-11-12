import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  GameId,
  SubClaimId,
  SubRequestId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { game } from "./game";
import { profileLineupGender } from "./profile";
import { teamSeason } from "./team";

/**
 * open: taking claims until closes_at (game time). filled: every spot has
 * an approved sub. cancelled: the captain took it down. A request past
 * closes_at is closed whatever its status says, so no job has to sweep it.
 */
export const subRequestStatus = pgEnum("sub_request_status", [
  "open",
  "filled",
  "cancelled",
]);

/**
 * A captain's call for subs for one game (docs/data-model.md, section 2.2).
 * women_needed and men_needed reserve spots for the fielding rule; the rest
 * of `needed` is open to anyone eligible.
 */
export const subRequest = pgTable(
  "sub_request",
  {
    id: uuid().primaryKey().defaultRandom().$type<SubRequestId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    requestedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    needed: integer().notNull(),
    womenNeeded: integer().notNull().default(0),
    menNeeded: integer().notNull().default(0),
    note: text(),
    status: subRequestStatus().notNull().default("open"),
    closesAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One live request per team per game; the captain changes it by
    // cancelling and posting again.
    uniqueIndex("sub_request_one_live")
      .on(t.gameId, t.teamSeasonId)
      .where(sql`${t.status} in ('open', 'filled')`),
    index("sub_request_team_status_idx").on(t.teamSeasonId, t.status),
    index("sub_request_open_idx")
      .on(t.closesAt)
      .where(sql`${t.status} = 'open'`),
    check("sub_request_needed_range", sql`${t.needed} between 1 and 11`),
    check(
      "sub_request_gender_within_needed",
      sql`${t.womenNeeded} >= 0 and ${t.menNeeded} >= 0 and ${t.womenNeeded} + ${t.menNeeded} <= ${t.needed}`,
    ),
    check(
      "sub_request_note_length",
      sql`${t.note} is null or char_length(${t.note}) <= 500`,
    ),
  ],
);

/**
 * pending: holds a spot until the captain answers. approved: the sub plays.
 * declined: the captain passed. withdrawn: the player backed out.
 */
export const subClaimStatus = pgEnum("sub_claim_status", [
  "pending",
  "approved",
  "declined",
  "withdrawn",
]);

/**
 * A player's "I'm in" for a sub request. lineup_gender is copied from the
 * profile when they claim, so later profile edits do not change which
 * reserved spot the claim fills.
 */
export const subClaim = pgTable(
  "sub_claim",
  {
    id: uuid().primaryKey().defaultRandom().$type<SubClaimId>(),
    subRequestId: uuid()
      .notNull()
      .$type<SubRequestId>()
      .references(() => subRequest.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    status: subClaimStatus().notNull().default("pending"),
    lineupGender: profileLineupGender(),
    claimedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
    decidedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("sub_claim_once").on(t.subRequestId, t.userId),
    index("sub_claim_user_idx").on(t.userId, t.status),
  ],
);

export type SubRequest = typeof subRequest.$inferSelect;
export type SubClaim = typeof subClaim.$inferSelect;
