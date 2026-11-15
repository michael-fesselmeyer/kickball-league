import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { LeagueId, SeasonId, UserId, WinBackEmailId } from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";

/**
 * Inviting past players back while a season's registration is open
 * (docs/data-model.md, section 2.4). The league's own wording for the
 * email, which admins edit; with no row, the default in
 * src/domain/win-back/template.ts is used.
 */
export const winBackTemplate = pgTable(
  "win_back_template",
  {
    leagueId: uuid()
      .primaryKey()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    subject: text().notNull(),
    body: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "win_back_template_lengths",
      sql`char_length(${t.subject}) between 1 and 120 and char_length(${t.body}) between 1 and 2000`,
    ),
  ],
);

/**
 * One win-back email to one past player for one season: at most one each
 * (the unique key). Whether they came back is read from their registration
 * in that season, never stored. Deleting the account deletes these rows.
 */
export const winBackEmail = pgTable(
  "win_back_email",
  {
    id: uuid().primaryKey().defaultRandom().$type<WinBackEmailId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    sentBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("win_back_email_once").on(t.seasonId, t.userId),
    index("win_back_email_user_idx").on(t.userId),
  ],
);

export type WinBackEmail = typeof winBackEmail.$inferSelect;
