import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
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
  BooksFileId,
  GameChecklistItemId,
  FieldCheckId,
  FieldId,
  GameId,
  MoveRequestId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { booksFile } from "./books";
import { field, game } from "./game";
import { season } from "./season";
import { teamSeason } from "./team";

/**
 * The game-day checklist (issue #409): what the league expects every game
 * day, before and after play, ticked by each team's captains; the set-up
 * lead's log of park users asked to move; and each field's set-up and
 * "left clean" checks. See docs/data-model.md, section 2.2.
 */

/** Before play or after it. */
export const gameChecklistPhase = pgEnum("game_checklist_phase", [
  "before",
  "after",
]);

/** One item on a season's checklist, in the order admins wrote them. */
export const gameChecklistItem = pgTable(
  "game_checklist_item",
  {
    id: uuid().primaryKey().defaultRandom().$type<GameChecklistItemId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    phase: gameChecklistPhase().notNull(),
    text: text().notNull(),
    position: smallint().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("game_checklist_item_season_idx").on(t.seasonId, t.phase, t.position),
    // Two first reads writing the defaults at once keep one copy.
    unique("game_checklist_item_once").on(t.seasonId, t.phase, t.text),
    check(
      "game_checklist_item_text_length",
      sql`char_length(${t.text}) between 1 and 140`,
    ),
  ],
);

/** A team's tick on one item for one game. */
export const gameChecklistTick = pgTable(
  "game_checklist_tick",
  {
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .$type<GameChecklistItemId>()
      .references(() => gameChecklistItem.id, { onDelete: "cascade" }),
    tickedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    tickedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.teamSeasonId, t.itemId] }),
    index("game_checklist_tick_item_idx").on(t.itemId),
    index("game_checklist_tick_ticked_by_idx").on(t.tickedBy),
  ],
);

/** How asking a group to move went. */
export const moveOutcome = pgEnum("move_outcome", [
  "fine",
  "refused",
  "complaint",
]);

/**
 * The set-up lead asked a group of park users to move. Anything but "fine"
 * shows on the admins' incidents screen.
 */
export const moveRequest = pgTable(
  "move_request",
  {
    id: uuid().primaryKey().defaultRandom().$type<MoveRequestId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    fieldId: uuid()
      .notNull()
      .$type<FieldId>()
      .references(() => field.id, { onDelete: "cascade" }),
    outcome: moveOutcome().notNull(),
    note: text(),
    askedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    askedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("move_request_season_idx").on(t.seasonId, t.askedAt),
    index("move_request_field_idx").on(t.fieldId),
    index("move_request_asked_by_idx").on(t.askedBy),
    check(
      "move_request_note_length",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 500`,
    ),
  ],
);

/** Set-up confirmed before play, or the field left after it. */
export const fieldCheckKind = pgEnum("field_check_kind", ["setup", "close"]);
export const fieldCheckStatus = pgEnum("field_check_status", ["ok", "problem"]);

/**
 * A field's set-up or end-of-day check on one game day: one of each per
 * field and day, replaced if someone confirms again. A problem carries a
 * note, and may carry a photo kept in the league's file store.
 */
export const fieldCheck = pgTable(
  "field_check",
  {
    id: uuid().primaryKey().defaultRandom().$type<FieldCheckId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    fieldId: uuid()
      .notNull()
      .$type<FieldId>()
      .references(() => field.id, { onDelete: "cascade" }),
    /** The game day, YYYY-MM-DD in the league's time zone. */
    date: date({ mode: "string" }).notNull(),
    kind: fieldCheckKind().notNull(),
    status: fieldCheckStatus().notNull(),
    note: text(),
    photoId: uuid()
      .$type<BooksFileId>()
      .references(() => booksFile.id, { onDelete: "set null" }),
    confirmedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    confirmedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("field_check_one_per_day").on(t.fieldId, t.date, t.kind),
    index("field_check_season_date_idx").on(t.seasonId, t.date),
    index("field_check_confirmed_by_idx").on(t.confirmedBy),
    index("field_check_photo_idx").on(t.photoId),
    check(
      "field_check_note_length",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 500`,
    ),
    check(
      "field_check_problem_says_why",
      sql`${t.status} = 'ok' or ${t.note} is not null`,
    ),
  ],
);
