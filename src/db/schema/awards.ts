import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AwardPollId,
  AwardVoteId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";
import { teamSeason } from "./team";

/** weekly: one game day's award. season: the whole season's. */
export const awardPollKind = pgEnum("award_poll_kind", ["weekly", "season"]);

/**
 * What the award is for. Player awards name a person; team_spirit and
 * best_dressed name a team (src/domain/awards/categories.ts).
 */
export const awardCategory = pgEnum("award_category", [
  "mvp",
  "best_play",
  "best_sport",
  "newcomer",
  "team_spirit",
  "best_dressed",
]);

/**
 * An awards poll (docs/data-model.md, section 2.5). Players on a roster
 * that season vote once between opens_at and closes_at; the tally is shown
 * only after closes_at. A weekly poll names the game day it covers, and its
 * nominees are the teams that played that day.
 */
export const awardPoll = pgTable(
  "award_poll",
  {
    id: uuid().primaryKey().defaultRandom().$type<AwardPollId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    kind: awardPollKind().notNull(),
    category: awardCategory().notNull(),
    title: text().notNull(),
    gameDay: date({ mode: "string" }),
    opensAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closesAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("award_poll_season_closes_idx").on(t.seasonId, t.closesAt),
    check("award_poll_times_order", sql`${t.closesAt} > ${t.opensAt}`),
    check(
      "award_poll_game_day_weekly",
      sql`(${t.kind} = 'weekly') = (${t.gameDay} is not null)`,
    ),
    check(
      "award_poll_title_length",
      sql`char_length(${t.title}) between 1 and 80`,
    ),
  ],
);

/**
 * One player's vote in a poll: a person or a team, never both. Who voted
 * for whom is never shown; only the totals, after the poll closes.
 */
export const awardVote = pgTable(
  "award_vote",
  {
    id: uuid().primaryKey().defaultRandom().$type<AwardVoteId>(),
    awardPollId: uuid()
      .notNull()
      .$type<AwardPollId>()
      .references(() => awardPoll.id, { onDelete: "cascade" }),
    voterId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    nomineeUserId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    nomineeTeamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    castAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("award_vote_once").on(t.awardPollId, t.voterId),
    index("award_vote_voter_idx").on(t.voterId),
    check(
      "award_vote_one_nominee",
      sql`(${t.nomineeUserId} is null) <> (${t.nomineeTeamSeasonId} is null)`,
    ),
    check(
      "award_vote_not_self",
      sql`${t.nomineeUserId} is null or ${t.nomineeUserId} <> ${t.voterId}`,
    ),
  ],
);

export type AwardPoll = typeof awardPoll.$inferSelect;
export type AwardVote = typeof awardVote.$inferSelect;
