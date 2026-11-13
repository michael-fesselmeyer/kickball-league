import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  SeasonId,
  TeamFormationRequestId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { season } from "./season";
import { teamSeason, teamSeasonPaymentMode } from "./team";

/**
 * pending: waiting for an admin. approved: the team exists (team_season_id).
 * declined: an admin said no, with an optional reason. withdrawn: the
 * requester took it back before an admin decided.
 */
export const teamFormationRequestStatus = pgEnum(
  "team_formation_request_status",
  ["pending", "approved", "declined", "withdrawn"],
);

/**
 * A player's request to start a new team in a season (docs/data-model.md,
 * section 2.1). Approval creates the team in "forming" status with the
 * requester as captain; from there the invite flow takes over.
 */
export const teamFormationRequest = pgTable(
  "team_formation_request",
  {
    id: uuid().primaryKey().defaultRandom().$type<TeamFormationRequestId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    requestedBy: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    proposedName: text().notNull(),
    /** How many players the requester expects; becomes the target roster size. */
    expectedSize: integer().notNull(),
    /** How the team will pay its fee, when the season charges per team. */
    paymentMode: teamSeasonPaymentMode().notNull().default("split"),
    note: text(),
    status: teamFormationRequestStatus().notNull().default("pending"),
    decidedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp({ withTimezone: true }),
    declineReason: text(),
    /** The team approval created. */
    teamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    /** The team the requester left on approval, whose captain was told. */
    leftTeamSeasonId: uuid()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One open request per person per season.
    uniqueIndex("team_formation_request_one_pending")
      .on(t.seasonId, t.requestedBy)
      .where(sql`${t.status} = 'pending'`),
    index("team_formation_request_season_idx").on(
      t.seasonId,
      t.status,
      t.createdAt,
    ),
    index("team_formation_request_user_idx").on(t.requestedBy),
    check(
      "team_formation_request_sizes",
      sql`${t.expectedSize} between 1 and 60`,
    ),
    check(
      "team_formation_request_text_lengths",
      sql`char_length(${t.proposedName}) between 1 and 40 and (${t.note} is null or char_length(${t.note}) <= 500) and (${t.declineReason} is null or char_length(${t.declineReason}) <= 500)`,
    ),
    check(
      "team_formation_request_decided",
      sql`(${t.status} in ('approved', 'declined')) = (${t.decidedAt} is not null)`,
    ),
    check(
      "team_formation_request_approved_has_team",
      sql`(${t.status} = 'approved') = (${t.teamSeasonId} is not null)`,
    ),
  ],
);

export type TeamFormationRequest = typeof teamFormationRequest.$inferSelect;
