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
import type { KeepOffId, TeamId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { team } from "./team";

/**
 * A team's private "not on my team" list (docs/data-model.md, section 2.1;
 * ADR 0036). One row keeps one league member off one team: the invite link
 * reads as expired for them, the matcher never suggests the team, and they
 * never see its sub requests. It belongs to the lasting team, so it carries
 * over from season to season. Nothing else about the person changes, and
 * they are never told. Admins and owners see every row; players never do.
 */
export const teamKeepOff = pgTable(
  "team_keep_off",
  {
    id: uuid().primaryKey().defaultRandom().$type<KeepOffId>(),
    teamId: uuid()
      .notNull()
      .$type<TeamId>()
      .references(() => team.id, { onDelete: "cascade" }),
    /** The person kept off. Deleting their account removes the row. */
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Private: the team's captains and the league's admins read it. */
    reason: text(),
    /** The captain or admin who added it. Deleting their account removes it. */
    addedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("team_keep_off_once").on(t.teamId, t.userId),
    index("team_keep_off_user_idx").on(t.userId),
    index("team_keep_off_added_by_idx").on(t.addedBy),
    check(
      "team_keep_off_reason_length",
      sql`${t.reason} is null or char_length(${t.reason}) between 1 and 300`,
    ),
  ],
);
