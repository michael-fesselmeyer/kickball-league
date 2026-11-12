import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
  BlackoutId,
  FieldId,
  GameId,
  GamePlacementId,
  PermitWindowId,
  ScheduleVersionId,
  SeasonId,
  SlotId,
  TeamConstraintId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { field, game, slot } from "./game";
import { season } from "./season";
import { teamSeason } from "./team";

/**
 * What the scheduler reads and writes: permits, blackouts, team constraints,
 * and versioned schedules. See docs/data-model.md, section 2.2, and
 * docs/scheduling-algorithm.md.
 */
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

export const permitStatus = pgEnum("permit_window_status", [
  "requested",
  "confirmed",
  "lost",
]);

/** When the league holds a field. Slots are cut from these. */
export const permitWindow = pgTable(
  "permit_window",
  {
    id: uuid().primaryKey().defaultRandom().$type<PermitWindowId>(),
    fieldId: uuid()
      .notNull()
      .$type<FieldId>()
      .references(() => field.id, { onDelete: "restrict" }),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    permitNumber: text(),
    status: permitStatus().notNull().default("requested"),
    ...audit(),
  },
  (t) => [
    index("permit_window_season_idx").on(t.seasonId, t.startsAt),
    check("permit_window_times_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** A date with no play, on every field (field_id null) or on one field. */
export const blackout = pgTable(
  "blackout",
  {
    id: uuid().primaryKey().defaultRandom().$type<BlackoutId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    onDate: date().notNull(),
    fieldId: uuid()
      .$type<FieldId>()
      .references(() => field.id, { onDelete: "restrict" }),
    reason: text(),
    ...audit(),
  },
  (t) => [
    unique("blackout_season_date_field_unique")
      .on(t.seasonId, t.onDate, t.fieldId)
      .nullsNotDistinct(),
  ],
);

export const teamConstraintKind = pgEnum("team_constraint_kind", [
  "unavailable",
  "prefer",
  "avoid",
]);

/** A team's date or time it cannot make, or would rather have or avoid. */
export const teamConstraint = pgTable(
  "team_constraint",
  {
    id: uuid().primaryKey().defaultRandom().$type<TeamConstraintId>(),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    kind: teamConstraintKind().notNull(),
    onDate: date(),
    /** 0 is the earliest slot of the day. */
    timeIndex: integer(),
    weight: integer().notNull().default(1),
    reason: text(),
    ...audit(),
  },
  (t) => [
    index("team_constraint_team_idx").on(t.teamSeasonId),
    check(
      "team_constraint_has_date_or_time",
      sql`${t.onDate} is not null or ${t.timeIndex} is not null`,
    ),
    check(
      "team_constraint_time_index_non_negative",
      sql`${t.timeIndex} is null or ${t.timeIndex} >= 0`,
    ),
    check("team_constraint_weight_range", sql`${t.weight} between 1 and 10`),
  ],
);

export const scheduleVersionStatus = pgEnum("schedule_version_status", [
  "draft",
  "published",
  "superseded",
]);
export const scheduleVersionOrigin = pgEnum("schedule_version_origin", [
  "generated",
  "manual_edit",
  "rainout",
  "playoffs",
]);

/**
 * One version of a season's schedule. Generating, editing or rescheduling
 * makes a new version, so any two can be compared and nothing is
 * overwritten. One version per season is published at a time.
 */
export const scheduleVersion = pgTable(
  "schedule_version",
  {
    id: uuid().primaryKey().defaultRandom().$type<ScheduleVersionId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    versionNo: integer().notNull(),
    parentVersionId: uuid()
      .$type<ScheduleVersionId>()
      .references((): AnyPgColumn => scheduleVersion.id, {
        onDelete: "set null",
      }),
    status: scheduleVersionStatus().notNull().default("draft"),
    origin: scheduleVersionOrigin().notNull(),
    seed: bigint({ mode: "number" }),
    /** The exact scheduler input, so the version can be reproduced. */
    inputSnapshot: jsonb().notNull(),
    metrics: jsonb(),
    /** Hard-constraint violations; empty when valid. */
    violations: jsonb().notNull().default([]),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    note: text(),
    ...audit(),
  },
  (t) => [
    unique("schedule_version_season_no_unique").on(t.seasonId, t.versionNo),
    uniqueIndex("schedule_version_one_published")
      .on(t.seasonId)
      .where(sql`${t.status} = 'published'`),
    check("schedule_version_no_positive", sql`${t.versionNo} > 0`),
    check(
      "schedule_version_published_has_time",
      sql`${t.status} = 'draft' or ${t.publishedAt} is not null`,
    ),
  ],
);

/** Where a game sits in one schedule version; slot_id null means unplaced. */
export const gamePlacement = pgTable(
  "game_placement",
  {
    id: uuid().primaryKey().defaultRandom().$type<GamePlacementId>(),
    scheduleVersionId: uuid()
      .notNull()
      .$type<ScheduleVersionId>()
      .references(() => scheduleVersion.id, { onDelete: "cascade" }),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    slotId: uuid()
      .$type<SlotId>()
      .references(() => slot.id, { onDelete: "restrict" }),
    /** A manual pin: the scheduler keeps this game in this slot. */
    locked: boolean().notNull().default(false),
  },
  (t) => [
    unique("game_placement_version_game_unique").on(
      t.scheduleVersionId,
      t.gameId,
    ),
    uniqueIndex("game_placement_version_slot_unique")
      .on(t.scheduleVersionId, t.slotId)
      .where(sql`${t.slotId} is not null`),
    check(
      "game_placement_locked_has_slot",
      sql`not ${t.locked} or ${t.slotId} is not null`,
    ),
  ],
);
