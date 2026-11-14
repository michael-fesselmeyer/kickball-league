import { sql } from "drizzle-orm";
import {
  check,
  index,
  inet,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  LeagueId,
  SeasonId,
  UserId,
  WaiverId,
  WaiverSignatureId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";

/**
 * A version of the league's liability waiver. Versions are never edited:
 * changing the text makes a new version, so every signature points at the
 * exact text that was shown. See docs/data-model.md, section 2.1.
 */
export const waiver = pgTable(
  "waiver",
  {
    id: uuid().primaryKey().defaultRandom().$type<WaiverId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    version: integer().notNull(),
    title: text().notNull(),
    bodyMd: text().notNull(),
    /** SHA-256 of body_md, hex; what a signature's hash must match. */
    bodySha256: text().notNull(),
    effectiveAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("waiver_league_version_unique").on(t.leagueId, t.version),
    check("waiver_version_positive", sql`${t.version} > 0`),
    check("waiver_sha256_format", sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Append-only: one person's signature of one waiver version for one season,
 * with the typed name, time, IP, browser, and a hash of the exact text shown.
 */
export const waiverSignature = pgTable(
  "waiver_signature",
  {
    id: uuid().primaryKey().defaultRandom().$type<WaiverSignatureId>(),
    waiverId: uuid()
      .notNull()
      .$type<WaiverId>()
      .references(() => waiver.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    signedName: text().notNull(),
    signedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: inet(),
    userAgent: text(),
    bodySha256: text().notNull(),
    /**
     * The minimum age the person confirmed they meet, and when (ADR 0041).
     * Only the confirmation is kept, never a birth date. Null on rows from
     * before the check, and on registrations an admin made for someone.
     */
    ageConfirmedMin: smallint(),
    ageConfirmedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("waiver_signature_once").on(t.waiverId, t.userId, t.seasonId),
    index("waiver_signature_user_idx").on(t.userId),
    check("waiver_signature_name", sql`length(trim(${t.signedName})) > 0`),
    check(
      "waiver_signature_age_confirmed",
      sql`(${t.ageConfirmedMin} is null) = (${t.ageConfirmedAt} is null) and (${t.ageConfirmedMin} is null or ${t.ageConfirmedMin} between 18 and 99)`,
    ),
  ],
);

export type Waiver = typeof waiver.$inferSelect;
export type WaiverSignature = typeof waiverSignature.$inferSelect;
