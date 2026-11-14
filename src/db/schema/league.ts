import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { LeagueId, UserId } from "@/domain/ids";
import { user } from "./auth";

/** Shapes of the league's flexible settings. Validated with Zod where they are edited. */
export type LeagueBranding = { primaryColor?: string; logoAssetId?: string };
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
 * One row per league. A deployment serves one league (docs/architecture.md),
 * but every league-owned table carries league_id so a second league fits later.
 * See docs/data-model.md, section 2.1.
 */
export const league = pgTable(
  "league",
  {
    id: uuid().primaryKey().defaultRandom().$type<LeagueId>(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    sport: text().notNull().default("kickball"),
    timezone: text().notNull().default("America/New_York"),
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
     * The youngest a player may be to register or sign a waiver (ADR 0041).
     * A season can set its own.
     */
    minimumAge: smallint().notNull().default(21),
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
      "league_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check("league_minimum_age", sql`${table.minimumAge} between 18 and 99`),
  ],
);

export type League = typeof league.$inferSelect;
export type NewLeague = typeof league.$inferInsert;
