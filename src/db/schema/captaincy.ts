import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CaptainHandoffId, TeamSeasonId, UserId } from "@/domain/ids";
import { user } from "./auth";
import { teamSeason } from "./team";

export const captainHandoffStatus = pgEnum("captain_handoff_status", [
  "pending",
  "accepted",
  "declined",
  "cancelled",
]);

/**
 * A captain's offer to hand their team to a teammate (docs/data-model.md,
 * section 2.1; ADR 0042). The captain keeps the role until the teammate
 * accepts; then the two swap in one transaction and the old captain stays
 * on as a co-captain. One offer waits at a time per team season; a new one
 * cancels the last. Co-captains are only a roster role
 * (roster_membership.role = co_captain) and need no table of their own.
 */
export const captainHandoff = pgTable(
  "captain_handoff",
  {
    id: uuid().primaryKey().defaultRandom().$type<CaptainHandoffId>(),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    /** The captain handing the team over, when the offer was made. */
    fromUserId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The teammate who is offered the captaincy. */
    toUserId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    status: captainHandoffStatus().notNull().default("pending"),
    /** Who made the offer: the captain, or an admin on their behalf. */
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("captain_handoff_one_pending")
      .on(t.teamSeasonId)
      .where(sql`${t.status} = 'pending'`),
    index("captain_handoff_to_idx").on(t.toUserId),
    check(
      "captain_handoff_someone_else",
      sql`${t.fromUserId} <> ${t.toUserId}`,
    ),
    check(
      "captain_handoff_decided",
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`,
    ),
  ],
);
