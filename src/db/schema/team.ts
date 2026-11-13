import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
  DivisionId,
  FriendGroupId,
  LeagueId,
  RegistrationId,
  RosterMembershipId,
  SeasonId,
  TeamId,
  TeamSeasonId,
  InviteId,
  UserId,
  WaiverSignatureId,
} from "@/domain/ids";
import { user } from "./auth";
import { division } from "./division";
import { league } from "./league";
import { season } from "./season";
import { waiverSignature } from "./waiver";

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

/**
 * A team's lasting identity: name, color, logo and history across seasons.
 * Its entry in one season is team_season. logo_asset_id arrives with assets.
 */
export const team = pgTable(
  "team",
  {
    id: uuid().primaryKey().defaultRandom().$type<TeamId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull(),
    colorHex: text(),
    deletedAt: timestamp({ withTimezone: true }),
    ...audit(),
  },
  (t) => [
    unique("team_league_slug_unique").on(t.leagueId, t.slug),
    check("team_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      "team_color_hex",
      sql`${t.colorHex} is null or ${t.colorHex} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);

export const teamSeasonStatus = pgEnum("team_season_status", [
  "forming",
  "pending_payment",
  "confirmed",
  "waitlisted",
  "withdrawn",
]);
export const teamSeasonPaymentMode = pgEnum("team_season_payment_mode", [
  "full",
  "split",
]);

/** A team's entry in one season. Rosters, payments and games hang off it. */
export const teamSeason = pgTable(
  "team_season",
  {
    id: uuid().primaryKey().defaultRandom().$type<TeamSeasonId>(),
    teamId: uuid()
      .notNull()
      .$type<TeamId>()
      .references(() => team.id, { onDelete: "restrict" }),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    status: teamSeasonStatus().notNull().default("forming"),
    paymentMode: teamSeasonPaymentMode().notNull().default("full"),
    shareCents: integer(),
    targetRosterSize: integer(),
    seed: integer(),
    vibe: text(),
    /** Null in a season without divisions, or before the admin assigns one. */
    divisionId: uuid().$type<DivisionId>(),
    ...audit(),
  },
  (t) => [
    unique("team_season_team_season_unique").on(t.teamId, t.seasonId),
    // A team can only be in a division of its own season.
    foreignKey({
      name: "team_season_division_fk",
      columns: [t.divisionId, t.seasonId],
      foreignColumns: [division.id, division.seasonId],
    }),
    index("team_season_division_idx").on(t.divisionId),
    index("team_season_season_status_idx").on(t.seasonId, t.status),
    check(
      "team_season_share_non_negative",
      sql`${t.shareCents} is null or ${t.shareCents} >= 0`,
    ),
  ],
);

export const registrationKind = pgEnum("registration_kind", [
  "team_member",
  "free_agent",
]);
export const registrationStatus = pgEnum("registration_status", [
  "pending_waiver",
  "pending_payment",
  "active",
  "waitlisted",
  "cancelled",
  "refunded",
]);
export const registrationShirtStatus = pgEnum("registration_shirt_status", [
  "none",
  "ordered",
  "received",
]);

/**
 * A few free agents who signed up together and want the same team. One of
 * them starts it and shares the code; the others enter it in their quiz.
 * The code is unique across seasons so a typo can never land in a group
 * from another season.
 */
export const friendGroup = pgTable(
  "friend_group",
  {
    id: uuid().primaryKey().defaultRandom().$type<FriendGroupId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    code: text().notNull(),
    ...audit(),
  },
  (t) => [
    unique("friend_group_code_unique").on(t.code),
    index("friend_group_season_idx").on(t.seasonId),
    check("friend_group_code_format", sql`${t.code} ~ '^[A-Z2-9]{6}$'`),
  ],
);

/** One person's entry in one season; carries waiver and payment state. */
export const registration = pgTable(
  "registration",
  {
    id: uuid().primaryKey().defaultRandom().$type<RegistrationId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    kind: registrationKind().notNull(),
    status: registrationStatus().notNull().default("pending_waiver"),
    waiverSignatureId: uuid()
      .$type<WaiverSignatureId>()
      .references((): AnyPgColumn => waiverSignature.id, {
        onDelete: "restrict",
      }),
    shirtStatus: registrationShirtStatus().notNull().default("none"),
    /** Friends who signed up together; set from the free-agent quiz. */
    friendGroupId: uuid()
      .$type<FriendGroupId>()
      .references((): AnyPgColumn => friendGroup.id, { onDelete: "set null" }),
    ...audit(),
  },
  (t) => [
    unique("registration_season_user_unique").on(t.seasonId, t.userId),
    index("registration_friend_group_idx").on(t.friendGroupId),
    index("registration_season_status_idx").on(t.seasonId, t.status),
    index("registration_user_idx").on(t.userId),
  ],
);

export const rosterRole = pgEnum("roster_membership_role", [
  "captain",
  "co_captain",
  "player",
]);
export const rosterStatus = pgEnum("roster_membership_status", [
  "invited",
  "active",
  "removed",
]);

/**
 * Puts a registration on a team, keeping history when someone moves teams.
 * A captain is a membership with role = captain: one source of truth.
 */
export const rosterMembership = pgTable(
  "roster_membership",
  {
    id: uuid().primaryKey().defaultRandom().$type<RosterMembershipId>(),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    registrationId: uuid()
      .notNull()
      .$type<RegistrationId>()
      .references(() => registration.id, { onDelete: "restrict" }),
    role: rosterRole().notNull().default("player"),
    status: rosterStatus().notNull().default("invited"),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    sharesContact: boolean().notNull().default(false),
    ...audit(),
  },
  (t) => [
    // No duplicate roster spots (removed rows are history and don't count).
    uniqueIndex("roster_membership_spot_unique")
      .on(t.teamSeasonId, t.registrationId)
      .where(sql`${t.status} <> 'removed'`),
    // A player is active on one team per season (a registration is per season).
    uniqueIndex("roster_membership_one_active_team")
      .on(t.registrationId)
      .where(sql`${t.status} = 'active'`),
    // Exactly one active captain per team-season.
    uniqueIndex("roster_membership_one_captain")
      .on(t.teamSeasonId)
      .where(sql`${t.role} = 'captain' and ${t.status} = 'active'`),
    index("roster_membership_team_status_idx").on(t.teamSeasonId, t.status),
    check(
      "roster_membership_dates_order",
      sql`${t.endedAt} is null or ${t.startedAt} is null or ${t.endedAt} >= ${t.startedAt}`,
    ),
  ],
);

export const inviteStatus = pgEnum("invite_status", [
  "open",
  "accepted",
  "revoked",
  "expired",
]);

/**
 * A link a captain shares to bring players onto the team. Only a hash of the
 * token is stored, so a database leak does not leak working links. A team
 * link (email null) can be used by many players until it is revoked or
 * expires; an email invite is for one person.
 */
export const invite = pgTable(
  "invite",
  {
    id: uuid().primaryKey().defaultRandom().$type<InviteId>(),
    teamSeasonId: uuid()
      .notNull()
      .$type<TeamSeasonId>()
      .references(() => teamSeason.id, { onDelete: "restrict" }),
    /** SHA-256 of the token in the link, hex. */
    tokenHash: text().notNull(),
    email: text(),
    status: inviteStatus().notNull().default("open"),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...audit(),
  },
  (t) => [
    unique("invite_token_hash_unique").on(t.tokenHash),
    index("invite_team_status_idx").on(t.teamSeasonId, t.status),
    check("invite_token_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type Team = typeof team.$inferSelect;
export type TeamSeason = typeof teamSeason.$inferSelect;
export type Registration = typeof registration.$inferSelect;
export type RosterMembership = typeof rosterMembership.$inferSelect;
export type Invite = typeof invite.$inferSelect;
export type FriendGroup = typeof friendGroup.$inferSelect;
