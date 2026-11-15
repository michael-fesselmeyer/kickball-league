import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ConductAcceptanceId,
  ConductCodeId,
  LeagueId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";

/**
 * A version of the league's code of conduct. Written in the app and stored
 * here, never committed. Versions are never edited: changing the text makes
 * a new version, so every acceptance points at the exact text that was shown
 * (docs/data-model.md, section 2.1, and ADR 0074).
 */
export const conductCode = pgTable(
  "conduct_code",
  {
    id: uuid().primaryKey().defaultRandom().$type<ConductCodeId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "restrict" }),
    version: integer().notNull(),
    title: text().notNull(),
    bodyMd: text().notNull(),
    /** SHA-256 of body_md, hex; what an acceptance's hash must match. */
    bodySha256: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("conduct_code_league_version_unique").on(t.leagueId, t.version),
    check("conduct_code_version_positive", sql`${t.version} > 0`),
    check(
      "conduct_code_sha256_format",
      sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/**
 * Append-only: one person's acceptance of one version of the code. A person
 * accepts each version once, at the first registration after it is
 * published, whichever way they join (a team, a team link or the free-agent
 * pool); later registrations reuse it.
 */
export const conductAcceptance = pgTable(
  "conduct_acceptance",
  {
    id: uuid().primaryKey().defaultRandom().$type<ConductAcceptanceId>(),
    codeId: uuid()
      .notNull()
      .$type<ConductCodeId>()
      .references(() => conductCode.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    /** The season whose registration asked for it. */
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    acceptedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Hash of the text shown, as for a waiver signature. */
    bodySha256: text().notNull(),
  },
  (t) => [
    unique("conduct_acceptance_once").on(t.codeId, t.userId),
    index("conduct_acceptance_user_idx").on(t.userId),
    check(
      "conduct_acceptance_sha256_format",
      sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type ConductCode = typeof conductCode.$inferSelect;
export type ConductAcceptance = typeof conductAcceptance.$inferSelect;
