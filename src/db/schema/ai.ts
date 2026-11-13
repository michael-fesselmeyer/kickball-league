import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AiUsageId,
  LeagueId,
  RecapDraftId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { season } from "./season";

/**
 * One row per call to the AI provider. Before the call the row reserves the
 * call's worst-case cost (`pending`), so two admins at once cannot both
 * spend the last of the budget; after it, the row holds the cost from the
 * response's token usage, whether or not the draft passed its checks,
 * because every answered call is billed. The month's spend is the sum of
 * `cost_microdollars`, and the features switch off at the league's monthly
 * budget.
 * See docs/data-model.md, section 2.10, and ADR 0013.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid().primaryKey().defaultRandom().$type<AiUsageId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    /** Which feature made the call, such as `recap`. */
    feature: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    /** Millionths of a dollar, rounded up. */
    costMicrodollars: integer().notNull(),
    /**
     * `pending` (reserved, call in flight), `accepted`, `rejected` (the
     * answer failed our checks) or `failed` (no answer, nothing billed).
     */
    outcome: text().notNull(),
    actorId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_league_month_idx").on(t.leagueId, t.createdAt),
    check("ai_usage_feature_format", sql`${t.feature} ~ '^[a-z_]+$'`),
    check(
      "ai_usage_outcome",
      sql`${t.outcome} in ('pending', 'accepted', 'rejected', 'failed')`,
    ),
    check(
      "ai_usage_counts",
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.cacheReadTokens} >= 0 and ${t.cacheWriteTokens} >= 0 and ${t.costMicrodollars} >= 0`,
    ),
  ],
);

/**
 * The latest AI-written recap for one game day of a season, kept so that
 * opening the recap screen again shows it without paying for another one.
 * Writing a new one replaces it. Nothing here is sent until an admin edits
 * it and sends it as an announcement.
 */
export const recapDraft = pgTable(
  "recap_draft",
  {
    id: uuid().primaryKey().defaultRandom().$type<RecapDraftId>(),
    seasonId: uuid()
      .notNull()
      .$type<SeasonId>()
      .references(() => season.id, { onDelete: "cascade" }),
    /** The game day, in the league's time zone. */
    day: date({ mode: "string" }).notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    model: text().notNull(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("recap_draft_season_day_key").on(t.seasonId, t.day),
    check(
      "recap_draft_lengths",
      sql`char_length(${t.subject}) between 1 and 120 and char_length(${t.body}) between 1 and 5000`,
    ),
  ],
);

export type AiUsage = typeof aiUsage.$inferSelect;
export type RecapDraft = typeof recapDraft.$inferSelect;
