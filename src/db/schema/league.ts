import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgEnum,
  pgTable,
  index,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { LeagueId, UserId } from "@/domain/ids";
import { user } from "./auth";

/** Shapes of the league's flexible settings. Validated with Zod where they are edited. */
export type LeagueBranding = {
  primaryColor?: string;
  secondaryColor?: string;
  logoAssetId?: string;
};
export type LeagueContact = {
  email?: string;
  phone?: string;
  whatsappUrl?: string;
  social?: Record<string, string>;
};

/** Set only by the platform operator; see src/domain/platform/operator.ts. */
export const siteStatus = pgEnum("site_status", [
  "active",
  "read_only",
  "paused",
]);

/**
 * One row per league. A deployment can run several (ADR 0048): every
 * league-owned table carries league_id, or a required key to a table that
 * does. The default league keeps the site's unprefixed URLs; every other
 * league's public pages live under /l/<slug>. See docs/data-model.md,
 * section 2.1.
 */
export const league = pgTable(
  "league",
  {
    id: uuid().primaryKey().defaultRandom().$type<LeagueId>(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    sport: text().notNull().default("kickball"),
    timezone: text().notNull().default("America/New_York"),
    /** The league served at the site's own URLs. Exactly one, once any exists. */
    isDefault: boolean().notNull().default(false),
    branding: jsonb().$type<LeagueBranding>().notNull().default({}),
    contact: jsonb().$type<LeagueContact>().notNull().default({}),
    /** Whether the site is open, read-only or paused (operator only). */
    siteStatus: siteStatus().notNull().default("active"),
    /** Features the operator switched off, by key (operator only). */
    disabledFeatures: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Whether a person's own data export lists the "not on my team" entries
     * about them (ADR 0036). Off by default; the owners decide.
     */
    exportKeepOffEntries: boolean().notNull().default(false),
    /**
     * The youngest a player may be to register or sign a waiver (ADRs 0041
     * and 0050): 18, the profile's floor, unless the league raises it. A
     * season can set its own.
     */
    minimumAge: smallint().notNull().default(18),
    /**
     * Whether players may pick their own team's games in pick'em (ADR 0044).
     * An admin decides; allowed by default.
     */
    pickemOwnGames: boolean().notNull().default(true),
    /**
     * Whether admins may confirm a rain-out themselves, for game days no
     * owner is around (ADR 0057). Off by default: admins send a rain-out
     * to the owners to confirm. The owners decide.
     */
    adminsConfirmRainouts: boolean().notNull().default(false),
    /**
     * Who may read the rulebook text (ADR 0086): the owners only, anyone
     * signed in, or everyone. Owners only until the league decides.
     */
    rulebookVisibility: text()
      .$type<"owners" | "members" | "public">()
      .notNull()
      .default("owners"),
    /**
     * How much of a team's roster must take part before a leadership
     * check-in can go to a secret ballot, and for the ballot to count, as a
     * percentage (ADR 0091). Admins decide; 60 by default.
     */
    leadershipQuorumPercent: smallint().notNull().default(60),
    /**
     * Whether payers cover processing fees, and how (ADR 0093). Read through
     * readFeeSettings, which fills in anything missing; off by default until
     * the league confirms the legal side.
     */
    processingFees: jsonb().notNull().default({ mode: "off" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    check(
      "league_rulebook_visibility",
      sql`${table.rulebookVisibility} in ('owners', 'members', 'public')`,
    ),
    check(
      "league_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check("league_minimum_age", sql`${table.minimumAge} between 18 and 99`),
    check(
      "league_leadership_quorum",
      sql`${table.leadershipQuorumPercent} between 50 and 100`,
    ),
    uniqueIndex("league_one_default")
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
);

export type League = typeof league.$inferSelect;
export type NewLeague = typeof league.$inferInsert;

/**
 * A person's role in one league. Everyone signed in is at least a player.
 * The type keeps its first name from when roles were global (ADR 0048).
 */
export const leagueRole = pgEnum("profile_global_role", [
  "player",
  "admin",
  "owner",
]);

/**
 * Who runs each league (ADR 0048). A row gives a person a role in one league
 * and makes the league theirs in the app's league switcher; playing there
 * (a registration) does that too, without a row. Owners and admins of one
 * league have no rights in another. Only the platform operator, and a
 * league's own owners for admins, change these.
 */
export const leagueMember = pgTable(
  "league_member",
  {
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    role: leagueRole().notNull().default("player"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.leagueId, t.userId] }),
    index("league_member_user_idx").on(t.userId),
  ],
);

export type LeagueMember = typeof leagueMember.$inferSelect;
