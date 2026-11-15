import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  InterestAnswerId,
  InterestFormId,
  InterestOptionId,
  LeagueId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";

export const interestNight = pgEnum("interest_night", [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const interestFormat = pgEnum("interest_format", [
  "social",
  "competitive",
]);

export const interestFormStatus = pgEnum("interest_form_status", [
  "open",
  "closed",
]);

/** "Yes" or "Not sure"; an option the player does not want has no row. */
export const interestResponse = pgEnum("interest_response", ["yes", "unsure"]);

/**
 * A public interest form (docs/data-model.md, section 2.7): the league asks
 * who would play on a new night, in a new park or in another format before
 * it books a permit. One form is open per league at a time. The target
 * (`teams_needed`, filled `players_per_team` at a time) is read when the
 * totals are shown, never copied into them, so changing it after answers
 * come in changes every option's marker.
 */
export const interestForm = pgTable(
  "interest_form",
  {
    id: uuid().primaryKey().defaultRandom().$type<InterestFormId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    title: text().notNull(),
    intro: text().notNull().default(""),
    status: interestFormStatus().notNull().default("open"),
    teamsNeeded: smallint().notNull().default(8),
    playersPerTeam: smallint().notNull().default(12),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Answerers' addresses are cleared six months after this. */
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("interest_form_one_open")
      .on(t.leagueId)
      .where(sql`${t.status} = 'open'`),
    index("interest_form_league_idx").on(t.leagueId, t.createdAt),
    check(
      "interest_form_lengths",
      sql`char_length(${t.title}) between 1 and 80 and char_length(${t.intro}) <= 600`,
    ),
    check(
      "interest_form_target",
      sql`${t.teamsNeeded} between 1 and 40 and ${t.playersPerTeam} between 6 and 25`,
    ),
    check(
      "interest_form_closed_at",
      sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`,
    ),
  ],
);

/**
 * One thing the league could run: a night, a park, a format, or a mix of
 * them (at least one is set). Once `go_ahead_at` is set the league has
 * decided to run it and everyone who picked it was told.
 */
export const interestOption = pgTable(
  "interest_option",
  {
    id: uuid().primaryKey().defaultRandom().$type<InterestOptionId>(),
    formId: uuid()
      .notNull()
      .$type<InterestFormId>()
      .references(() => interestForm.id, { onDelete: "cascade" }),
    park: text(),
    night: interestNight(),
    format: interestFormat(),
    /** Lists options in the order the admin entered them. */
    position: integer().notNull().default(0),
    goAheadAt: timestamp({ withTimezone: true }),
    goAheadBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** What the admin added to the message, such as when registration opens. */
    goAheadNote: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("interest_option_form_idx").on(t.formId, t.position),
    check(
      "interest_option_has_a_part",
      sql`${t.park} is not null or ${t.night} is not null or ${t.format} is not null`,
    ),
    check(
      "interest_option_park_length",
      sql`${t.park} is null or char_length(${t.park}) between 1 and 80`,
    ),
    check(
      "interest_option_note_length",
      sql`${t.goAheadNote} is null or char_length(${t.goAheadNote}) <= 500`,
    ),
    check(
      "interest_option_go_ahead_set",
      sql`${t.goAheadNote} is null or ${t.goAheadAt} is not null`,
    ),
  ],
);

/**
 * One person's answer to a form: the address to tell when an option goes
 * ahead, and how many friends might join (null: not sure). An address
 * answers once per form; answering again replaces the earlier answer. The
 * address is cleared six months after the form closes, which keeps the
 * totals and drops the person.
 */
export const interestAnswer = pgTable(
  "interest_answer",
  {
    id: uuid().primaryKey().defaultRandom().$type<InterestAnswerId>(),
    formId: uuid()
      .notNull()
      .$type<InterestFormId>()
      .references(() => interestForm.id, { onDelete: "cascade" }),
    /** Lower case. Null once cleared. */
    email: text(),
    friends: smallint(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("interest_answer_one_per_address").on(t.formId, t.email),
    index("interest_answer_purge_idx")
      .on(t.formId)
      .where(sql`${t.email} is not null`),
    check(
      "interest_answer_friends",
      sql`${t.friends} is null or ${t.friends} between 0 and 10`,
    ),
    check(
      "interest_answer_email_length",
      sql`${t.email} is null or char_length(${t.email}) between 3 and 254`,
    ),
  ],
);

/** What an answer said about one option. */
export const interestChoice = pgTable(
  "interest_choice",
  {
    answerId: uuid()
      .notNull()
      .$type<InterestAnswerId>()
      .references(() => interestAnswer.id, { onDelete: "cascade" }),
    optionId: uuid()
      .notNull()
      .$type<InterestOptionId>()
      .references(() => interestOption.id, { onDelete: "cascade" }),
    response: interestResponse().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.answerId, t.optionId] }),
    index("interest_choice_option_idx").on(t.optionId),
  ],
);
