import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AccountMergeId, UserId } from "@/domain/ids";
import { user } from "./auth";

/**
 * One merge of a duplicate account into another (ADR 0041). The
 * merged-away account's records now point at the kept account; this row
 * keeps the old address as an alias, so a sign-in link or a lookup by that
 * address reaches the kept account, and records what was moved.
 */
export const accountMerge = pgTable(
  "account_merge",
  {
    id: uuid().primaryKey().defaultRandom().$type<AccountMergeId>(),
    keptUserId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    mergedUserId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "restrict" }),
    /** The merged-away account's address, lower case: now an alias. */
    mergedEmail: text().notNull(),
    /** How many rows moved, and how each clash was settled. */
    summary: jsonb().$type<Record<string, number>>().notNull().default({}),
    mergedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_merge_merged_once").on(t.mergedUserId),
    uniqueIndex("account_merge_email_once").on(t.mergedEmail),
    index("account_merge_kept_idx").on(t.keptUserId),
    check(
      "account_merge_two_accounts",
      sql`${t.keptUserId} <> ${t.mergedUserId}`,
    ),
    check(
      "account_merge_email_lower",
      sql`${t.mergedEmail} = lower(${t.mergedEmail})`,
    ),
  ],
);

export type AccountMerge = typeof accountMerge.$inferSelect;
