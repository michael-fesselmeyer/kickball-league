import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  BooksFileId,
  ExpenseId,
  InsuranceCertificateId,
  LeagueId,
  MerchantRuleId,
  RecurringCostId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { CADENCES } from "@/domain/books/expected";
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

export const recurringCadence = pgEnum("recurring_cadence", CADENCES);

/**
 * A cost the owners set once (ADR 0054): a permit, insurance, ref pay, a
 * bar deposit. The books expect it each season or each game day from
 * `starts_on`, for an owner to confirm or skip; nothing is stored for an
 * occurrence until then. Removing one archives it, so the expenses it
 * settled keep their link.
 */
export const recurringCost = pgTable(
  "recurring_cost",
  {
    id: uuid().primaryKey().defaultRandom().$type<RecurringCostId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    label: text().notNull(),
    category: expenseCategory().notNull(),
    amountCents: integer().notNull(),
    cadence: recurringCadence().notNull(),
    startsOn: date({ mode: "string" }).notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("recurring_cost_league").on(t.leagueId),
    check("recurring_cost_amount", sql`${t.amountCents} > 0`),
    check(
      "recurring_cost_label",
      sql`char_length(${t.label}) between 1 and 80`,
    ),
  ],
);

/** An expected occurrence an owner said won't be paid (a rained-out day). */
export const recurringCostSkip = pgTable(
  "recurring_cost_skip",
  {
    recurringCostId: uuid()
      .notNull()
      .$type<RecurringCostId>()
      .references(() => recurringCost.id, { onDelete: "cascade" }),
    /** Seasons can overlap, so an occurrence belongs to one season. */
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    dueOn: date({ mode: "string" }).notNull(),
    skippedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    skippedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recurringCostId, t.seasonId, t.dueOn] })],
);

/**
 * The owners' own category guesses for imported statement rows: a
 * lowercase substring of the description, longest match first, ahead of
 * the built-in rules (src/domain/books/statement.ts).
 */
export const merchantRule = pgTable(
  "merchant_rule",
  {
    id: uuid().primaryKey().defaultRandom().$type<MerchantRuleId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    pattern: text().notNull(),
    category: expenseCategory().notNull(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("merchant_rule_pattern").on(t.leagueId, t.pattern),
    check(
      "merchant_rule_pattern_length",
      sql`char_length(${t.pattern}) between 2 and 60`,
    ),
  ],
);

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
    /** An owner said there is no receipt; it no longer counts as missing. */
    noReceipt: boolean().notNull().default(false),
    /** Who paid out of their own pocket; null when league money paid. */
    paidBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    reimbursedAt: timestamp({ withTimezone: true }),
    reimbursedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** The expected cost this settled, and which occurrence of it. */
    recurringCostId: uuid()
      .$type<RecurringCostId>()
      .references(() => recurringCost.id, { onDelete: "set null" }),
    dueOn: date({ mode: "string" }),
    /**
     * Hex SHA-256 of an imported statement row's key, so importing an
     * overlapping statement skips rows already in. Never the row itself.
     */
    importKey: text(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expense_season").on(t.seasonId, t.spentOn),
    index("expense_receipt").on(t.receiptFileId),
    index("expense_paid_by")
      .on(t.paidBy)
      .where(sql`${t.reimbursedAt} is null`),
    unique("expense_occurrence").on(t.recurringCostId, t.seasonId, t.dueOn),
    unique("expense_import_key").on(t.seasonId, t.importKey),
    check("expense_amount", sql`${t.amountCents} > 0`),
    check(
      "expense_no_receipt",
      sql`not (${t.noReceipt} and ${t.receiptFileId} is not null)`,
    ),
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
