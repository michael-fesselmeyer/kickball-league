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
  uuid,
} from "drizzle-orm/pg-core";
import type {
  GameId,
  IncidentId,
  IncidentNoteId,
  SeasonId,
  SportsmanshipRatingId,
  SuspensionId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { game } from "./game";
import { season } from "./season";
import { teamSeason } from "./team";

/**
 * One captain's rating of the other team's sportsmanship in a final game
 * (docs/data-model.md, section 2.7). One per team per game. Ratings are
 * read only as averages; the note goes to admins without saying who wrote
 * it. rated_by is kept so the person's own export lists it and deleting
 * their account can clear the note.
 */
export const sportsmanshipRating = pgTable(
  "sportsmanship_rating",
  {
    id: uuid().primaryKey().defaultRandom().$type<SportsmanshipRatingId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    /** The team whose captain rated. */
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    ratedTeamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    score: smallint().notNull(),
    note: text(),
    ratedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    ratedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("sportsmanship_rating_once").on(t.gameId, t.teamSeasonId),
    index("sportsmanship_rating_rated_idx").on(t.ratedTeamSeasonId),
    index("sportsmanship_rating_by_idx").on(t.ratedBy),
    check("sportsmanship_rating_score", sql`${t.score} between 1 and 5`),
    check(
      "sportsmanship_rating_other_team",
      sql`${t.teamSeasonId} <> ${t.ratedTeamSeasonId}`,
    ),
    check(
      "sportsmanship_rating_note_length",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 200`,
    ),
  ],
);

export const incidentKind = pgEnum("incident_kind", [
  "ejection",
  "forfeit_related",
  "unsportsmanlike",
  "outside_alcohol",
  "safety",
  "other",
]);
/** Whose account the report is: the game's ref, a captain, or an admin. */
export const incidentReporterRole = pgEnum("incident_reporter_role", [
  "referee",
  "captain",
  "admin",
]);
export const incidentStatus = pgEnum("incident_status", ["open", "resolved"]);

/**
 * A report of something that happened at a game (docs/data-model.md,
 * section 2.7). Admins review open reports and resolve them.
 */
export const incident = pgTable(
  "incident",
  {
    id: uuid().primaryKey().defaultRandom().$type<IncidentId>(),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    kind: incidentKind().notNull(),
    details: text().notNull(),
    reportedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    reporterRole: incidentReporterRole().notNull(),
    status: incidentStatus().notNull().default("open"),
    reportedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("incident_status_reported_idx").on(t.status, t.reportedAt),
    index("incident_game_idx").on(t.gameId),
    check(
      "incident_details_length",
      sql`char_length(${t.details}) between 1 and 2000`,
    ),
    check(
      "incident_resolved_at",
      sql`(${t.status} = 'resolved') = (${t.resolvedAt} is not null)`,
    ),
  ],
);

/** The people an incident is about, each with the team they played for. */
export const incidentPerson = pgTable(
  "incident_person",
  {
    incidentId: uuid()
      .notNull()
      .$type<IncidentId>()
      .references(() => incident.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.incidentId, t.userId] }),
    index("incident_person_user_idx").on(t.userId),
  ],
);

/** An admin's note while reviewing an incident. Only admins read them. */
export const incidentNote = pgTable(
  "incident_note",
  {
    id: uuid().primaryKey().defaultRandom().$type<IncidentNoteId>(),
    incidentId: uuid()
      .notNull()
      .$type<IncidentId>()
      .references(() => incident.id, { onDelete: "cascade" }),
    authorId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    body: text().notNull(),
    writtenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("incident_note_incident_idx").on(t.incidentId, t.writtenAt),
    index("incident_note_author_idx").on(t.authorId),
    check(
      "incident_note_body_length",
      sql`char_length(${t.body}) between 1 and 1000`,
    ),
  ],
);

export const suspensionScope = pgEnum("suspension_scope", [
  "games",
  "season",
  "permanent",
]);

/**
 * A player's suspension, issued from an incident. Games served are counted
 * from the player's team games that went final after starts_at, not stored
 * (docs/adr/0026-discipline-counted-not-stored.md). A season suspension
 * ends with season_id's season; a permanent one lasts until lifted.
 */
export const suspension = pgTable(
  "suspension",
  {
    id: uuid().primaryKey().defaultRandom().$type<SuspensionId>(),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    incidentId: uuid()
      .notNull()
      .$type<IncidentId>()
      .references(() => incident.id, { onDelete: "cascade" }),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    scope: suspensionScope().notNull(),
    games: integer(),
    startsAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    issuedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    liftedAt: timestamp({ withTimezone: true }),
    liftedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("suspension_once_per_incident").on(t.incidentId, t.userId),
    index("suspension_user_idx").on(t.userId),
    check(
      "suspension_games",
      sql`(${t.scope} = 'games') = (${t.games} is not null) and (${t.games} is null or ${t.games} between 1 and 20)`,
    ),
  ],
);

export type SportsmanshipRating = typeof sportsmanshipRating.$inferSelect;
export type Incident = typeof incident.$inferSelect;
export type Suspension = typeof suspension.$inferSelect;
