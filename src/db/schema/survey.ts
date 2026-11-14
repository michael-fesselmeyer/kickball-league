import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  SeasonId,
  SeasonSurveyId,
  SurveyAnswerId,
  SurveyResponseId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";

/**
 * The end-of-season survey (docs/data-model.md, section 2.5): one per
 * season, opened by an admin once the season is completed. The questions
 * are fixed (src/domain/survey/questions.ts).
 */
export const seasonSurvey = pgTable(
  "season_survey",
  {
    id: uuid().primaryKey().defaultRandom().$type<SeasonSurveyId>(),
    seasonId: uuid()
      .notNull()
      .unique("season_survey_one_per_season")
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    openedAt: timestamp({ withTimezone: true }).notNull(),
    /** Closed by an admin: no more answers. */
    closedAt: timestamp({ withTimezone: true }),
    openedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "season_survey_closed_after_open",
      sql`${t.closedAt} is null or ${t.closedAt} >= ${t.openedAt}`,
    ),
  ],
);

/**
 * That a player has answered, and nothing else: no answer, no time. The
 * unique key keeps it to one answer per player.
 */
export const surveyResponse = pgTable(
  "survey_response",
  {
    id: uuid().primaryKey().defaultRandom().$type<SurveyResponseId>(),
    surveyId: uuid()
      .notNull()
      .$type<SeasonSurveyId>()
      .references(() => seasonSurvey.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [unique("survey_response_once").on(t.surveyId, t.userId)],
);

export const surveyReturn = pgEnum("survey_return", ["yes", "maybe", "no"]);

/**
 * One answer, with no column that points at a person and no time, so the
 * database itself can't say who gave it. Written in the same transaction
 * as the player's survey_response row.
 */
export const surveyAnswer = pgTable(
  "survey_answer",
  {
    id: uuid().primaryKey().defaultRandom().$type<SurveyAnswerId>(),
    surveyId: uuid()
      .notNull()
      .$type<SeasonSurveyId>()
      .references(() => seasonSurvey.id, { onDelete: "cascade" }),
    rating: smallint().notNull(),
    wouldReturn: surveyReturn().notNull(),
    bestPart: text(),
    oneChange: text(),
    comment: text(),
  },
  (t) => [
    index("survey_answer_survey_idx").on(t.surveyId),
    check("survey_answer_rating", sql`${t.rating} between 1 and 5`),
    check(
      "survey_answer_best_part_length",
      sql`${t.bestPart} is null or char_length(${t.bestPart}) between 1 and 500`,
    ),
    check(
      "survey_answer_one_change_length",
      sql`${t.oneChange} is null or char_length(${t.oneChange}) between 1 and 500`,
    ),
    check(
      "survey_answer_comment_length",
      sql`${t.comment} is null or char_length(${t.comment}) between 1 and 1000`,
    ),
  ],
);

export type SeasonSurvey = typeof seasonSurvey.$inferSelect;
export type SurveyAnswer = typeof surveyAnswer.$inferSelect;
