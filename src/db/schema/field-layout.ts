import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { BooksFileId, FieldId, UserId } from "@/domain/ids";
import { MAX_LAYOUT_NOTE } from "@/domain/fields/layout";
import { user } from "./auth";
import { booksFile } from "./books";
import { field } from "./game";

/**
 * Where a permitted field's area ends and each diamond and spectator area
 * goes (issue #403): one layout image or PDF per field, with a short note,
 * or an admin's word that the field needs none. The image is a stored
 * file like a permit document, under the same size limits
 * (docs/data-model.md, section 2.9). Fields are the league's own and don't
 * move between seasons, so the layout belongs to the field and each season
 * checks its fields have one before the schedule is published.
 */
export const fieldLayout = pgTable(
  "field_layout",
  {
    fieldId: uuid()
      .primaryKey()
      .$type<FieldId>()
      .references(() => field.id, { onDelete: "cascade" }),
    fileId: uuid()
      .$type<BooksFileId>()
      .references(() => booksFile.id, { onDelete: "set null" }),
    /** An admin said this field needs no layout. */
    noLayoutNeeded: boolean().notNull().default(false),
    /** For example "cones at the four corners". */
    note: text(),
    updatedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "field_layout_one_answer",
      sql`not (${t.noLayoutNeeded} and ${t.fileId} is not null)`,
    ),
    check(
      "field_layout_note",
      sql`${t.note} is null or char_length(${t.note}) between 1 and ${sql.raw(String(MAX_LAYOUT_NOTE))}`,
    ),
  ],
);
