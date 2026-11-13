import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SeasonId, UserId, WaitlistEntryId } from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";

/**
 * The team waitlist for a full season (docs/data-model.md, section 2.3).
 * Captains wait in the order they joined. When a spot opens, the next one is
 * offered it for a fixed time; an offer whose time has passed counts as
 * expired at once, whether or not the job has marked it yet.
 */
export const waitlistStatus = pgEnum("waitlist_status", [
  "waiting",
  "offered",
  "accepted",
  "expired",
  "left",
]);

export const waitlistEntry = pgTable(
  "waitlist_entry",
  {
    id: uuid().primaryKey().defaultRandom().$type<WaitlistEntryId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    /** The team they mean to bring, so admins know who is waiting. */
    teamName: text(),
    status: waitlistStatus().notNull().default("waiting"),
    offeredAt: timestamp({ withTimezone: true }),
    offerExpiresAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("waitlist_entry_one_open")
      .on(t.seasonId, t.userId)
      .where(sql`${t.status} in ('waiting', 'offered')`),
    index("waitlist_entry_season_status_idx").on(
      t.seasonId,
      t.status,
      t.createdAt,
    ),
    check(
      "waitlist_entry_offer_times",
      sql`(${t.offeredAt} is null) = (${t.offerExpiresAt} is null) and (${t.status} <> 'offered' or ${t.offerExpiresAt} is not null)`,
    ),
  ],
);

export type WaitlistEntry = typeof waitlistEntry.$inferSelect;
