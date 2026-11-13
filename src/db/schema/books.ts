import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  BooksFileId,
  ExpenseId,
  InsuranceCertificateId,
  LeagueId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { FILE_MAX_BYTES } from "@/domain/books/files";
import { EXPENSE_CATEGORIES } from "@/domain/books/ledger";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";
import { bytea } from "./social";

/**
 * The owners' books (docs/data-model.md, section 2.9; ADR 0034): expenses
 * with their receipt photos, permit documents and the league's insurance
 * certificate. Income is not stored here: it is read from the payments the
 * app already records. Only owners and the platform operator see any of it,
 * except a permit's document, which the referee and captains of a game on
 * that permit see at the field.
 */

/** What a stored file is for; it decides who may read it. */
export const booksFileKind = pgEnum("books_file_kind", [
  "receipt",
  "permit",
  "insurance",
]);

/**
 * One stored file. Photos are resized and re-encoded on the server before
 * they get here (src/lib/books/store-file.ts), so the copy is small and
 * carries no location metadata; a PDF is kept as uploaded. Bytes live in
 * Postgres because the project has no file store, and the total is capped
 * (src/domain/books/files.ts) to stay inside the free database tier.
 */
export const booksFile = pgTable(
  "books_file",
  {
    id: uuid().primaryKey().defaultRandom().$type<BooksFileId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    kind: booksFileKind().notNull(),
    contentType: text().notNull(),
    bytes: bytea().notNull(),
    byteSize: integer().notNull(),
    /** Hex SHA-256 of the bytes, used as the ETag. */
    sha256: text().notNull(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("books_file_league").on(t.leagueId),
    check(
      "books_file_type",
      sql`${t.contentType} in ('image/webp', 'application/pdf')`,
    ),
    check(
      "books_file_size",
      sql`${t.byteSize} = octet_length(${t.bytes}) and ${t.byteSize} between 1 and ${sql.raw(String(FILE_MAX_BYTES))}`,
    ),
  ],
);

export const expenseCategory = pgEnum("expense_category", EXPENSE_CATEGORIES);

/** Money the league spent, entered by an owner. */
export const expense = pgTable(
  "expense",
  {
    id: uuid().primaryKey().defaultRandom().$type<ExpenseId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "restrict" }),
    spentOn: date({ mode: "string" }).notNull(),
    amountCents: integer().notNull(),
    category: expenseCategory().notNull(),
    note: text(),
    receiptFileId: uuid()
      .$type<BooksFileId>()
      .references(() => booksFile.id, { onDelete: "set null" }),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expense_season").on(t.seasonId, t.spentOn),
    index("expense_receipt").on(t.receiptFileId),
    check("expense_amount", sql`${t.amountCents} > 0`),
  ],
);

/** The league's liability insurance certificate, which NYC Parks asks for. */
export const insuranceCertificate = pgTable(
  "insurance_certificate",
  {
    id: uuid().primaryKey().defaultRandom().$type<InsuranceCertificateId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    insurer: text().notNull(),
    policyNumber: text(),
    startsOn: date({ mode: "string" }).notNull(),
    expiresOn: date({ mode: "string" }).notNull(),
    documentFileId: uuid()
      .$type<BooksFileId>()
      .references(() => booksFile.id, { onDelete: "set null" }),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("insurance_certificate_league").on(t.leagueId, t.expiresOn),
    index("insurance_certificate_document").on(t.documentFileId),
    check("insurance_certificate_dates", sql`${t.expiresOn} > ${t.startsOn}`),
  ],
);

export type BooksFileKind = (typeof booksFileKind.enumValues)[number];
