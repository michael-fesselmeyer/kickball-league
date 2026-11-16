import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  LeagueId,
  MoveInterestId,
  MoveInviteId,
  SeasonId,
  TeamId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";
import { team } from "./team";

/** Who may see that a player is looking for a change (ADR 0081). */
export const moveAudience = pgEnum("move_audience", [
  "admins",
  "captains",
  "both",
]);

/**
 * A player quietly open to a new team next season (docs/data-model.md,
 * section 2.1; ADR 0081). One row per person per league. Never shown to
 * any team the person has played on, nor on a public page; a recruiting
 * captain sees only a count until the person accepts their invite. It
 * stops counting once a league season's registration closes after it was
 * set (src/domain/move), and the daily purge deletes it then. Withdrawing
 * deletes the row, and its invites with it.
 */
export const moveInterest = pgTable(
  "move_interest",
  {
    id: uuid().primaryKey().defaultRandom().$type<MoveInterestId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    audience: moveAudience().notNull(),
    /** Optional, such as a preferred night. Read by the audience only. */
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("move_interest_once").on(t.leagueId, t.userId),
    index("move_interest_user_idx").on(t.userId),
    check(
      "move_interest_note_length",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 140`,
    ),
  ],
);

export const moveInviteStatus = pgEnum("move_invite_status", [
  "pending",
  "accepted",
  "declined",
]);

/**
 * A recruiting team's invite to one person looking for a change, sent
 * without the team knowing who (ADR 0081). The team learns the name only
 * when the status is `accepted`. Belongs to the interest, so withdrawing
 * or expiry deletes it.
 */
export const moveInvite = pgTable(
  "move_invite",
  {
    id: uuid().primaryKey().defaultRandom().$type<MoveInviteId>(),
    interestId: uuid()
      .notNull()
      .$type<MoveInterestId>()
      .references(() => moveInterest.id, { onDelete: "cascade" }),
    /** The lasting team inviting. */
    teamId: uuid()
      .notNull()
      .$type<TeamId>()
      .references(() => team.id, { onDelete: "cascade" }),
    /** The season the team is recruiting for. */
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    /** The captain or co-captain who sent it. */
    sentBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** The team's short pitch, the same for everyone it was sent to. */
    message: text(),
    status: moveInviteStatus().notNull().default("pending"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("move_invite_once").on(t.interestId, t.teamId),
    index("move_invite_team_idx").on(t.teamId, t.seasonId),
    index("move_invite_sent_by_idx").on(t.sentBy),
    index("move_invite_season_idx").on(t.seasonId),
    check(
      "move_invite_message_length",
      sql`${t.message} is null or char_length(${t.message}) between 1 and 300`,
    ),
    check(
      "move_invite_answered",
      sql`(${t.status} = 'pending') = (${t.respondedAt} is null)`,
    ),
  ],
);
