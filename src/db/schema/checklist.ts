import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ChecklistTaskId,
  ChecklistTemplateTaskId,
  LeagueId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";

/**
 * The league's season ops checklist template (ADR 0061): the tasks that
 * come round every season, each due a number of days before or after the
 * season starts. Owners edit it; starting a season's checklist copies it.
 */
export const checklistTemplateTask = pgTable(
  "checklist_template_task",
  {
    id: uuid().primaryKey().defaultRandom().$type<ChecklistTemplateTaskId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    title: text().notNull(),
    notes: text().notNull().default(""),
    /** Days from the season's first day: negative is before it. */
    offsetDays: smallint().notNull(),
    /** Who usually does it: copied to each season's task. */
    ownerId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "checklist_template_task_title_length",
      sql`char_length(${t.title}) between 1 and 120`,
    ),
    check(
      "checklist_template_task_notes_length",
      sql`char_length(${t.notes}) <= 1000`,
    ),
    check(
      "checklist_template_task_offset",
      sql`${t.offsetDays} between -365 and 365`,
    ),
    index("checklist_template_task_league_idx").on(t.leagueId),
  ],
);

/**
 * One task on a season's ops checklist, seen by owners and admins only.
 * A task copied from the template remembers it, once per season, so
 * starting the checklist twice adds nothing. Reminders to its owner are
 * keyed on the owner and the due date, so changing either sends afresh.
 */
export const checklistTask = pgTable(
  "checklist_task",
  {
    id: uuid().primaryKey().defaultRandom().$type<ChecklistTaskId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    templateTaskId: uuid()
      .$type<ChecklistTemplateTaskId>()
      .references(() => checklistTemplateTask.id, { onDelete: "set null" }),
    title: text().notNull(),
    notes: text().notNull().default(""),
    dueOn: date({ mode: "string" }).notNull(),
    ownerId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    doneAt: timestamp({ withTimezone: true }),
    doneBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("checklist_task_from_template_once").on(
      t.seasonId,
      t.templateTaskId,
    ),
    check(
      "checklist_task_title_length",
      sql`char_length(${t.title}) between 1 and 120`,
    ),
    check("checklist_task_notes_length", sql`char_length(${t.notes}) <= 1000`),
    index("checklist_task_season_due_idx").on(t.seasonId, t.dueOn),
    index("checklist_task_open_due_idx")
      .on(t.dueOn)
      .where(sql`${t.doneAt} is null`),
  ],
);

export type ChecklistTemplateTask = typeof checklistTemplateTask.$inferSelect;
export type ChecklistTask = typeof checklistTask.$inferSelect;
