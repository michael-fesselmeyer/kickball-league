import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EquipmentAssignmentId,
  EquipmentHandoffId,
  EquipmentKitId,
  EquipmentReportId,
  GameId,
  LeagueId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { game } from "./game";
import { league } from "./league";

/**
 * The league's gear (docs/data-model.md, section 2.10): kits of ball bags,
 * bases, pumps, cones and the first-aid kit, who has each one right now,
 * who brings it to which game, and every handoff in between. The rules are
 * in src/domain/equipment; src/db/queries/equipment.ts reads and writes.
 */

/**
 * One kit. `holderId` is who has it right now; null means it is at its home
 * location. It changes only when a handoff is confirmed, a holder picks it
 * up from home or returns it there, or an admin says where it is.
 */
export const equipmentKit = pgTable(
  "equipment_kit",
  {
    id: uuid().primaryKey().defaultRandom().$type<EquipmentKitId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    /** "Kit A". */
    name: text().notNull(),
    /** What is in it, one item per entry: "Ball bag (4 balls)", "Pump". */
    contents: text().array().notNull(),
    /** Where it lives between game days: "Storage locker at McCarren". */
    homeLocation: text().notNull(),
    /** Who has it now. Deleting their account leaves it unaccounted for at home. */
    holderId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** Set when the kit is no longer used; it keeps its history. */
    retiredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("equipment_kit_league_name_unique").on(t.leagueId, t.name),
    index("equipment_kit_holder_idx").on(t.holderId),
    check(
      "equipment_kit_name_length",
      sql`char_length(${t.name}) between 1 and 40`,
    ),
    check(
      "equipment_kit_home_length",
      sql`char_length(${t.homeLocation}) between 1 and 120`,
    ),
    check(
      "equipment_kit_contents_count",
      sql`cardinality(${t.contents}) between 1 and 20`,
    ),
  ],
);

/**
 * Who brings a kit to a game. The game gives the field and the time; the
 * person has it there half an hour before kickoff (src/domain/equipment).
 * A kit goes to one game a day, which the query layer checks under a lock
 * on the kit.
 */
export const equipmentAssignment = pgTable(
  "equipment_assignment",
  {
    id: uuid().primaryKey().defaultRandom().$type<EquipmentAssignmentId>(),
    kitId: uuid()
      .notNull()
      .$type<EquipmentKitId>()
      .references(() => equipmentKit.id, { onDelete: "cascade" }),
    gameId: uuid()
      .notNull()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "cascade" }),
    /** Usually the game's ref or a captain. Deleting their account removes it. */
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("equipment_assignment_kit_game_unique").on(t.kitId, t.gameId),
    index("equipment_assignment_game_idx").on(t.gameId),
    index("equipment_assignment_user_idx").on(t.userId),
  ],
);

export const equipmentHandoffStatus = pgEnum("equipment_handoff_status", [
  "pending",
  "confirmed",
  "declined",
  "cancelled",
]);

/**
 * The handoff log: every time a kit changes hands. "I handed Kit A to Sam"
 * is a pending row until Sam confirms it; a pick-up from home, a return
 * home and an admin's correction are written already confirmed. A null
 * `fromUserId` is the kit's home, and so is a null `toUserId`. One handoff
 * waits at a time per kit.
 */
export const equipmentHandoff = pgTable(
  "equipment_handoff",
  {
    id: uuid().primaryKey().defaultRandom().$type<EquipmentHandoffId>(),
    kitId: uuid()
      .notNull()
      .$type<EquipmentKitId>()
      .references(() => equipmentKit.id, { onDelete: "cascade" }),
    fromUserId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    toUserId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    status: equipmentHandoffStatus().notNull().default("pending"),
    /** Who wrote it: the giver, the person picking up, or an admin. */
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("equipment_handoff_one_pending")
      .on(t.kitId)
      .where(sql`${t.status} = 'pending'`),
    index("equipment_handoff_kit_created_idx").on(t.kitId, t.createdAt),
    index("equipment_handoff_to_idx").on(t.toUserId),
    index("equipment_handoff_from_idx").on(t.fromUserId),
    check(
      "equipment_handoff_decided",
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`,
    ),
  ],
);

/**
 * Items missing from a kit, reported by whoever has it or brings it, with a
 * note. Open until an admin marks it sorted.
 */
export const equipmentReport = pgTable(
  "equipment_report",
  {
    id: uuid().primaryKey().defaultRandom().$type<EquipmentReportId>(),
    kitId: uuid()
      .notNull()
      .$type<EquipmentKitId>()
      .references(() => equipmentKit.id, { onDelete: "cascade" }),
    reporterId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** Items from the kit's contents that were not there. */
    missing: text().array().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("equipment_report_kit_idx").on(t.kitId, t.createdAt),
    index("equipment_report_reporter_idx").on(t.reporterId),
    index("equipment_report_resolved_by_idx").on(t.resolvedBy),
    check(
      "equipment_report_note_length",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 500`,
    ),
    check(
      "equipment_report_says_something",
      sql`cardinality(${t.missing}) > 0 or ${t.note} is not null`,
    ),
  ],
);
