import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  LeadershipCandidateId,
  LeadershipCheckInId,
  LeadershipOptionId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { teamSeason } from "./team";

/**
 * A team's season-end leadership check-in (docs/data-model.md, section 2.1;
 * ADR 0077). Secrecy rests on four rules, which tests check:
 *
 * - Who took part (`leadership_participation`) is stored apart from what
 *   they chose (`leadership_candidate.nominated`, `leadership_ballot_option
 *   .votes`), with nothing linking the two.
 * - Neither the candidate nor the option table has a created or updated
 *   time, and participation has no time at all.
 * - A check-in or vote updates every candidate or option row of its
 *   check-in in one statement, so no row's last writer marks a choice.
 * - No audit row or log line is written for a check-in or a vote.
 */

export const leadershipStep = pgEnum("leadership_step", [
  "check_in",
  "ballot",
  "captain_review",
  "closed",
]);

export const leadershipOutcome = pgEnum("leadership_outcome", [
  /** Not enough of the roster took part. */
  "no_quorum",
  /** Nobody but the captain stood for captain. */
  "no_candidates",
  /** A tie, or no option over half the ballots. */
  "no_majority",
  "captain_stays",
  "new_captain",
  /** The ballot's winner had left the team when it closed. */
  "winner_left",
  /** An admin closed it with no change. */
  "closed_by_league",
]);

export const leadershipCaptainChoice = pgEnum("leadership_captain_choice", [
  /** The captaincy is offered to the teammate now (ADR 0042). */
  "hand_off_now",
  /** The teammate co-captains now and is offered it next season. */
  "captain_elect",
]);

export const leadershipRole = pgEnum("leadership_role", [
  "captain",
  "co_captain",
]);

export const leadershipAnswer = pgEnum("leadership_answer", [
  "accepted",
  "declined",
]);

export const leadershipPart = pgEnum("leadership_part", ["check_in", "ballot"]);

export const leadershipCheckIn = pgTable(
  "leadership_check_in",
  {
    id: uuid().primaryKey().defaultRandom().$type<LeadershipCheckInId>(),
    /** Once per team per season. */
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" })
      .unique(),
    step: leadershipStep().notNull().default("check_in"),
    /**
     * What the team is told. A ballot's result is set when it closes and
     * kept for the captain's private three days; the team hears it when
     * the step is `closed`.
     */
    outcome: leadershipOutcome(),
    /** The league's quorum when it opened, as a percentage of the roster. */
    quorumPercent: smallint().notNull(),
    /** The captain said, in their own check-in, they'd hand over. */
    captainSteppingDown: boolean().notNull().default(false),
    checkInClosesAt: timestamp({ withTimezone: true }).notNull(),
    ballotClosesAt: timestamp({ withTimezone: true }),
    /** End of the captain's private three days with a ballot's result. */
    reviewEndsAt: timestamp({ withTimezone: true }),
    /** The ballot's winner, when it isn't the current captain. */
    electedUserId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    captainChoice: leadershipCaptainChoice(),
    /** When the captain-elect was offered the captaincy next season. */
    electOfferedAt: timestamp({ withTimezone: true }),
    /** Set while an admin has it paused. */
    pausedAt: timestamp({ withTimezone: true }),
    openedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("leadership_check_in_step_idx").on(t.step),
    check(
      "leadership_check_in_closed",
      sql`(${t.step} = 'closed') = (${t.closedAt} is not null) and (${t.step} <> 'closed' or ${t.outcome} is not null)`,
    ),
    check(
      "leadership_check_in_quorum",
      sql`${t.quorumPercent} between 50 and 100`,
    ),
    check(
      "leadership_check_in_review",
      sql`${t.step} <> 'captain_review' or (${t.reviewEndsAt} is not null and ${t.outcome} is not null)`,
    ),
    check(
      "leadership_check_in_elected",
      sql`${t.outcome} is distinct from 'new_captain' or ${t.electedUserId} is not null`,
    ),
    check(
      "leadership_check_in_ballot",
      sql`${t.step} not in ('ballot', 'captain_review') or ${t.ballotClosesAt} is not null`,
    ),
  ],
);

/**
 * A teammate standing, or suggested, for a role. One row per person on the
 * roster and role, created before any choice is written, so a row's
 * existence says nothing. `nominated` says only that somebody suggested
 * them, never who. No created or updated time, on purpose.
 */
export const leadershipCandidate = pgTable(
  "leadership_candidate",
  {
    id: uuid().primaryKey().defaultRandom().$type<LeadershipCandidateId>(),
    checkInId: uuid()
      .notNull()
      .$type<LeadershipCheckInId>()
      .references(() => leadershipCheckIn.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    role: leadershipRole().notNull(),
    /** They put themselves forward; they stand without being asked. */
    volunteered: boolean().notNull().default(false),
    /** At least one teammate suggested them. */
    nominated: boolean().notNull().default(false),
    /** When the daily job asked them whether they'd stand. */
    askedAt: timestamp({ withTimezone: true }),
    answer: leadershipAnswer(),
    answeredAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("leadership_candidate_once").on(t.checkInId, t.userId, t.role),
    index("leadership_candidate_user_idx").on(t.userId),
    check(
      "leadership_candidate_answered",
      sql`(${t.answer} is null) = (${t.answeredAt} is null)`,
    ),
  ],
);

/**
 * One choice on a team's secret ballot and how many ballots chose it. A
 * vote adds 1 to its option and 0 to every other option in one statement.
 * No time and no voter, on purpose.
 */
export const leadershipBallotOption = pgTable(
  "leadership_ballot_option",
  {
    id: uuid().primaryKey().defaultRandom().$type<LeadershipOptionId>(),
    checkInId: uuid()
      .notNull()
      .$type<LeadershipCheckInId>()
      .references(() => leadershipCheckIn.id, { onDelete: "cascade" }),
    /** The teammate this option makes captain; the captain to keep them. */
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    votes: integer().notNull().default(0),
  },
  (t) => [
    unique("leadership_ballot_option_once").on(t.checkInId, t.userId),
    index("leadership_ballot_option_user_idx").on(t.userId),
    check("leadership_ballot_option_votes", sql`${t.votes} >= 0`),
  ],
);

/**
 * That a person checked in, or voted, once each. Never what they chose,
 * and no time.
 */
export const leadershipParticipation = pgTable(
  "leadership_participation",
  {
    checkInId: uuid()
      .notNull()
      .$type<LeadershipCheckInId>()
      .references(() => leadershipCheckIn.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    part: leadershipPart().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.checkInId, t.userId, t.part] }),
    index("leadership_participation_user_idx").on(t.userId),
  ],
);

export type LeadershipCheckIn = typeof leadershipCheckIn.$inferSelect;
