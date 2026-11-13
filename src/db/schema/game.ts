import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  FieldId,
  GameId,
  GamePeriodId,
  GameRsvpId,
  LeagueId,
  PermitWindowId,
  ScoreReportId,
  RefereeAssignmentId,
  ScoreResponseId,
  SeasonId,
  SlotId,
  TeamSeasonId,
  UserId,
  VenueId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { permitWindow } from "./schedule";
import { season } from "./season";
import { teamSeason } from "./team";

const audit = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "set null" }),
});

/** A park or complex, such as McCarren Park. See docs/data-model.md, section 2.2. */
export const venue = pgTable(
  "venue",
  {
    id: uuid().primaryKey().defaultRandom().$type<VenueId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull(),
    address: text(),
    lat: numeric({ precision: 9, scale: 6 }),
    lng: numeric({ precision: 9, scale: 6 }),
    neighborhood: text(),
    ...audit(),
  },
  (t) => [
    unique("venue_league_slug_unique").on(t.leagueId, t.slug),
    check("venue_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/** One playable field at a venue. */
export const field = pgTable(
  "field",
  {
    id: uuid().primaryKey().defaultRandom().$type<FieldId>(),
    venueId: uuid()
      .notNull()
      .$type<VenueId>()
      .references(() => venue.id, { onDelete: "restrict" }),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
    notes: text(),
    ...audit(),
  },
  (t) => [unique("field_venue_name_unique").on(t.venueId, t.name)],
);

export const slotKind = pgEnum("slot_kind", [
  "regular",
  "makeup_reserve",
  "playoff",
]);
export const slotStatus = pgEnum("slot_status", ["open", "cancelled"]);

/** A field at a time that a game can be placed in, cut from a permit window. */
export const slot = pgTable(
  "slot",
  {
    id: uuid().primaryKey().defaultRandom().$type<SlotId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    fieldId: uuid()
      .notNull()
      .$type<FieldId>()
      .references(() => field.id, { onDelete: "restrict" }),
    permitWindowId: uuid()
      .$type<PermitWindowId>()
      .references(() => permitWindow.id, { onDelete: "restrict" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    /** 0 is the earliest slot of the day. */
    timeIndex: integer().notNull(),
    kind: slotKind().notNull().default("regular"),
    status: slotStatus().notNull().default("open"),
    ...audit(),
  },
  (t) => [
    unique("slot_field_start_unique").on(t.fieldId, t.startsAt),
    index("slot_season_starts_idx").on(t.seasonId, t.startsAt),
    check("slot_times_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("slot_time_index_non_negative", sql`${t.timeIndex} >= 0`),
  ],
);

export const gameKind = pgEnum("game_kind", [
  "regular",
  "playoff",
  "exhibition",
]);
export const gameStatus = pgEnum("game_status", [
  "scheduled",
  "in_progress",
  "final",
  "postponed",
  "cancelled",
  "forfeit",
]);

/**
 * A matchup between two team entries. slot_id is its place in the published
 * schedule; division_id arrives with divisions.
 */
export const game = pgTable(
  "game",
  {
    id: uuid().primaryKey().defaultRandom().$type<GameId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    roundNo: integer(),
    teamAId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    teamBId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    kind: gameKind().notNull().default("regular"),
    status: gameStatus().notNull().default("scheduled"),
    slotId: uuid()
      .$type<SlotId>()
      .references(() => slot.id, { onDelete: "set null" }),
    scoreA: integer(),
    scoreB: integer(),
    inningsPlayed: integer(),
    forfeitBy: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    finalizedAt: timestamp({ withTimezone: true }),
    /**
     * The team that kicks in the top of each inning, decided at the field and
     * set when live scoring starts. Null until then.
     */
    kicksFirst: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    ...audit(),
  },
  (t) => [
    index("game_season_status_idx").on(t.seasonId, t.status),
    index("game_team_a_idx").on(t.teamAId),
    index("game_team_b_idx").on(t.teamBId),
    index("game_slot_idx").on(t.slotId),
    check("game_distinct_teams", sql`${t.teamAId} <> ${t.teamBId}`),
    check(
      "game_scores_non_negative",
      sql`coalesce(${t.scoreA}, 0) >= 0 and coalesce(${t.scoreB}, 0) >= 0`,
    ),
    check(
      "game_final_has_score",
      sql`${t.status} <> 'final' or (${t.scoreA} is not null and ${t.scoreB} is not null and ${t.finalizedAt} is not null)`,
    ),
    check(
      "game_kicks_first_a_team",
      sql`${t.kicksFirst} is null or ${t.kicksFirst} in (${t.teamAId}, ${t.teamBId})`,
    ),
    check(
      "game_forfeit_by_a_team",
      sql`(${t.status} = 'forfeit') = (${t.forfeitBy} is not null) and (${t.forfeitBy} is null or ${t.forfeitBy} in (${t.teamAId}, ${t.teamBId}))`,
    ),
  ],
);

export const scoreReporterRole = pgEnum("score_report_reporter_role", [
  "referee",
  "captain",
  "admin",
]);
export const scoreOutcome = pgEnum("score_report_outcome", [
  "normal",
  "forfeit_a",
  "forfeit_b",
  "called",
]);

/**
 * A score as entered from someone's phone. Append-only: reports are history;
 * the game row holds the result. client_id makes a retried submit a no-op.
 */
export const scoreReport = pgTable(
  "score_report",
  {
    id: uuid().primaryKey().defaultRandom().$type<ScoreReportId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "restrict" }),
    reportedBy: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    reporterRole: scoreReporterRole().notNull(),
    /** The reporting captain's team; null for refs and admins. */
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    scoreA: integer().notNull(),
    scoreB: integer().notNull(),
    inningsPlayed: integer(),
    outcome: scoreOutcome().notNull().default("normal"),
    clientId: text().notNull(),
    reportedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("score_report_client_id_unique").on(t.clientId),
    index("score_report_game_idx").on(t.gameId, t.reportedAt),
    check(
      "score_report_scores_non_negative",
      sql`${t.scoreA} >= 0 and ${t.scoreB} >= 0`,
    ),
  ],
);

export const scoreResponseStatus = pgEnum("score_response_status", [
  "confirmed",
  "disputed",
]);

/**
 * A captain's answer to a score report: confirm it, or dispute it with a
 * note. Append-only, one answer per team per report.
 */
export const scoreResponse = pgTable(
  "score_response",
  {
    id: uuid().primaryKey().defaultRandom().$type<ScoreResponseId>(),
    scoreReportId: uuid()
      .notNull()
      .$type<ScoreReportId>()
      .references(() => scoreReport.id, { onDelete: "restrict" }),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    status: scoreResponseStatus().notNull(),
    note: text(),
    respondedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("score_response_once").on(t.scoreReportId, t.teamSeasonId)],
);

export const periodHalf = pgEnum("game_period_half", ["top", "bottom"]);

/**
 * The runs scored in one half-inning, entered live by the ref or a captain
 * (docs/data-model.md, section 2.2). One row per half; a correction updates
 * the row. Named for periods, not innings, so another sport can reuse it.
 */
export const gamePeriod = pgTable(
  "game_period",
  {
    id: uuid().primaryKey().defaultRandom().$type<GamePeriodId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    /** The inning, from 1. */
    periodNo: integer().notNull(),
    half: periodHalf().notNull(),
    runs: integer().notNull(),
    /** Who entered or last corrected it. */
    enteredBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    enteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("game_period_once").on(t.gameId, t.periodNo, t.half),
    check("game_period_no_range", sql`${t.periodNo} between 1 and 20`),
    check("game_period_runs_range", sql`${t.runs} between 0 and 99`),
  ],
);

export const refereeAssignmentStatus = pgEnum("referee_assignment_status", [
  "offered",
  "accepted",
  "declined",
  "completed",
  "no_show",
  "cancelled",
]);

/**
 * Who referees a game (docs/data-model.md, section 2.6). The MVP uses only
 * assignments an admin creates as accepted; offers, availability and pay
 * wait for the owners' approval. One live assignment per game.
 */
export const refereeAssignment = pgTable(
  "referee_assignment",
  {
    id: uuid().primaryKey().defaultRandom().$type<RefereeAssignmentId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    status: refereeAssignmentStatus().notNull().default("accepted"),
    offeredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp({ withTimezone: true }),
    feeCents: integer(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("referee_assignment_one_live")
      .on(t.gameId)
      .where(sql`${t.status} in ('offered', 'accepted')`),
    index("referee_assignment_user_idx").on(t.userId, t.status),
  ],
);

export const rsvpStatus = pgEnum("game_rsvp_status", ["in", "out", "maybe"]);

/** A player's answer for one game, so the captain knows who is coming. */
export const gameRsvp = pgTable(
  "game_rsvp",
  {
    id: uuid().primaryKey().defaultRandom().$type<GameRsvpId>(),
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
    status: rsvpStatus().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("game_rsvp_once").on(t.gameId, t.userId),
    index("game_rsvp_team_idx").on(t.gameId, t.teamSeasonId),
  ],
);

export type Venue = typeof venue.$inferSelect;
export type Field = typeof field.$inferSelect;
export type Slot = typeof slot.$inferSelect;
export type Game = typeof game.$inferSelect;
export type ScoreReport = typeof scoreReport.$inferSelect;
export type GamePeriod = typeof gamePeriod.$inferSelect;
