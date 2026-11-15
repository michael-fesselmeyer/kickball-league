import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  FieldGroupId,
  FieldId,
  FieldOverlapId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { field } from "./game";

/**
 * Other groups that use a field before or after the league (issue #408). The
 * game-day crews read these for the next handover, and the permits screen
 * warns about a day two groups hold the same time. Admin-only data: the
 * contact is never read by a public page or an export.
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

export const fieldGroup = pgTable(
  "field_group",
  {
    id: uuid().primaryKey().defaultRandom().$type<FieldGroupId>(),
    fieldId: uuid()
      .notNull()
      .$type<FieldId>()
      .references(() => field.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Usual days, 0 (Sunday) to 6, in the league's time zone. Empty when not known. */
    weekdays: integer().array().notNull().default(sql`'{}'::integer[]`),
    /** Usual hours, local wall clock. An end at or before the start runs past midnight. */
    startsAt: time({ precision: 0 }),
    endsAt: time({ precision: 0 }),
    /** A phone or email for the group's contact. Only the league's admins see it. */
    contact: text(),
    ...audit(),
  },
  (t) => [
    index("field_group_field_idx").on(t.fieldId),
    check("field_group_name", sql`length(btrim(${t.name})) between 1 and 80`),
    check(
      "field_group_weekdays",
      sql`${t.weekdays} <@ array[0,1,2,3,4,5,6]`,
    ),
    check(
      "field_group_hours",
      sql`(cardinality(${t.weekdays}) = 0 and ${t.startsAt} is null and ${t.endsAt} is null)
        or (cardinality(${t.weekdays}) > 0 and ${t.startsAt} is not null and ${t.endsAt} is not null and ${t.startsAt} <> ${t.endsAt})`,
    ),
    check(
      "field_group_contact",
      sql`${t.contact} is null or length(${t.contact}) <= 200`,
    ),
  ],
);

/** A day two groups hold the same time on a field, recorded ahead or on the day. */
export const fieldOverlap = pgTable(
  "field_overlap",
  {
    id: uuid().primaryKey().defaultRandom().$type<FieldOverlapId>(),
    groupId: uuid()
      .notNull()
      .$type<FieldGroupId>()
      .references(() => fieldGroup.id, { onDelete: "cascade" }),
    onDate: date({ mode: "string" }).notNull(),
    note: text(),
    ...audit(),
  },
  (t) => [
    unique("field_overlap_group_date_unique").on(t.groupId, t.onDate),
    index("field_overlap_date_idx").on(t.onDate),
    check(
      "field_overlap_note",
      sql`${t.note} is null or length(${t.note}) <= 300`,
    ),
  ],
);
