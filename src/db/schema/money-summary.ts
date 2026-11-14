import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SeasonId, UserId } from "@/domain/ids";
import type { MoneySummary } from "@/domain/dashboard/money";
import { user } from "./auth";
import { expenseCategory } from "./books";
import { season } from "./season";

/**
 * A season's published money summary (ADR 0038; docs/data-model.md,
 * section 2.9): where the money went, by category totals only, as it was
 * when an owner published it. No row means nothing is published, which is
 * the default; unpublishing deletes the row. The numbers are a copy, so the
 * public page shows exactly what the owner previewed, and a later expense
 * changes it only when an owner publishes again.
 */
export const moneySummary = pgTable(
  "money_summary",
  {
    seasonId: uuid()
      .primaryKey()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    /** Categories shown inside "Other" so their totals stay private. */
    folded: expenseCategory()
      .array()
      .notNull()
      .default(sql`'{}'`),
    summary: jsonb().$type<MoneySummary>().notNull(),
    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    check("money_summary_not_other", sql`not ('other' = any(${t.folded}))`),
  ],
);

export type MoneySummaryRow = typeof moneySummary.$inferSelect;
