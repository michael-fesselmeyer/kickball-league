import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CaptainPollId,
  CaptainPollOptionId,
  CaptainPollVoteId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";
import { teamSeason } from "./team";

/**
 * When captains see the totals: after their team has voted, or only once
 * voting closes. Admins always see them as they come in.
 */
export const captainPollResults = pgEnum("captain_poll_results", [
  "after_voting",
  "at_close",
]);

/**
 * A quick poll for a season's captains (docs/data-model.md, section 2.5;
 * ADR 0063). An admin asks one question with two to five options and a
 * closing time; each team gets one vote, from its captain or, when the poll
 * says so, a co-captain. It shares the awards poll's open, close and
 * closing-time rules (src/domain/awards/awards.ts).
 */
export const captainPoll = pgTable(
  "captain_poll",
  {
    id: uuid().primaryKey().defaultRandom().$type<CaptainPollId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    /** The question. */
    title: text().notNull(),
    /** Background for the captains; empty when there is none. */
    detail: text().notNull().default(""),
    /** Co-captains may vote for their team too. */
    includeCoCaptains: boolean().notNull().default(false),
    results: captainPollResults().notNull().default("after_voting"),
    opensAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closesAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("captain_poll_season_closes_idx").on(t.seasonId, t.closesAt),
    check("captain_poll_times_order", sql`${t.closesAt} > ${t.opensAt}`),
    check(
      "captain_poll_title_length",
      sql`char_length(${t.title}) between 1 and 120`,
    ),
    check("captain_poll_detail_length", sql`char_length(${t.detail}) <= 600`),
  ],
);

/** One answer a poll offers, in the order the admin wrote them. */
export const captainPollOption = pgTable(
  "captain_poll_option",
  {
    id: uuid().primaryKey().defaultRandom().$type<CaptainPollOptionId>(),
    captainPollId: uuid()
      .notNull()
      .$type<CaptainPollId>()
      .references(() => captainPoll.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    label: text().notNull(),
  },
  (t) => [
    unique("captain_poll_option_position").on(t.captainPollId, t.position),
    check(
      "captain_poll_option_position_range",
      sql`${t.position} between 1 and 5`,
    ),
    check(
      "captain_poll_option_label_length",
      sql`char_length(${t.label}) between 1 and 80`,
    ),
  ],
);

/**
 * A team's one vote in a poll. Changing the vote overwrites the row, so
 * when two captains of one team answer differently the last one wins.
 */
export const captainPollVote = pgTable(
  "captain_poll_vote",
  {
    id: uuid().primaryKey().defaultRandom().$type<CaptainPollVoteId>(),
    captainPollId: uuid()
      .notNull()
      .$type<CaptainPollId>()
      .references(() => captainPoll.id, { onDelete: "cascade" }),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    optionId: uuid()
      .notNull()
      .$type<CaptainPollOptionId>()
      .references(() => captainPollOption.id, { onDelete: "cascade" }),
    /** Whose answer it is now: the captain who cast or last changed it. */
    voterId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    castAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("captain_poll_vote_once").on(t.captainPollId, t.teamSeasonId),
    index("captain_poll_vote_option_idx").on(t.optionId),
    index("captain_poll_vote_team_idx").on(t.teamSeasonId),
  ],
);

export type CaptainPoll = typeof captainPoll.$inferSelect;
export type CaptainPollOption = typeof captainPollOption.$inferSelect;
export type CaptainPollVote = typeof captainPollVote.$inferSelect;
