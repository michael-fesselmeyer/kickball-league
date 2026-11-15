import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ActingAdminId, LeagueId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";

/**
 * A handover: an owner names a trusted player as acting admin for a date
 * range with a chosen set of powers (src/domain/authz/acting-admin.ts). It
 * gives nothing before `starts_at` or from `ends_at`, or once `ended_at` is
 * set. Deleting the player's account deletes their grants; what they did
 * stays in the audit log. See docs/data-model.md, section 2.14.
 */
export const actingAdmin = pgTable(
  "acting_admin",
  {
    id: uuid().primaryKey().defaultRandom().$type<ActingAdminId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Names from ACTING_POWERS. */
    powers: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    /** Set when an owner ends it early. */
    endedAt: timestamp({ withTimezone: true }),
    grantedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** The start and end notices go out once each. */
    startNoticeAt: timestamp({ withTimezone: true }),
    endNoticeAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("acting_admin_user_idx").on(t.userId, t.leagueId),
    index("acting_admin_league_idx").on(t.leagueId, t.endsAt.desc()),
    check("acting_admin_dates", sql`${t.endsAt} > ${t.startsAt}`),
    check("acting_admin_has_powers", sql`cardinality(${t.powers}) > 0`),
  ],
);
