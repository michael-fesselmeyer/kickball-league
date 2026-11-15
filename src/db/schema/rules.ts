import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  LeagueId,
  RuleChangeId,
  RuleSectionId,
  UserId,
} from "@/domain/ids";
import type { SectionChange } from "@/domain/rules/rules";
import { user } from "./auth";
import { league } from "./league";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * The league's rules as they stand, one row per section (ADR 0062). Admins
 * write the text in the app; none of it is in the repository. The public
 * rules page shows the sections in `position` order, each with an anchor
 * from its slug.
 */
export const ruleSection = pgTable(
  "rule_section",
  {
    id: uuid().primaryKey().defaultRandom().$type<RuleSectionId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    position: smallint().notNull(),
    /**
     * What the rulebook search matches: the title weighs more than the text
     * (ADR 0066). Kept by Postgres, never written by the app.
     */
    search: tsvector().generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')`,
    ),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("rule_section_league_slug").on(t.leagueId, t.slug),
    index("rule_section_search_idx").using("gin", t.search),
    check(
      "rule_section_title_length",
      sql`char_length(${t.title}) between 1 and 80`,
    ),
    check(
      "rule_section_body_length",
      sql`char_length(${t.body}) between 1 and 20000`,
    ),
    check(
      "rule_section_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

/**
 * One published change to the rules: when it was published, when it takes
 * effect, a one-line summary, and each section it added, edited or removed
 * with the text before and after. Rows are never changed, so the list is
 * the rules' history. A change marked for notice queued a message to every
 * player in the active seasons when it was published.
 */
export const ruleChange = pgTable(
  "rule_change",
  {
    id: uuid().primaryKey().defaultRandom().$type<RuleChangeId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    summary: text().notNull(),
    changes: jsonb().$type<SectionChange[]>().notNull(),
    effectiveOn: date({ mode: "string" }).notNull(),
    notice: boolean().notNull().default(false),
    /** How many players the notice was queued for. */
    noticeRecipients: integer(),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /**
     * The wall clock, not the transaction's start: publishes queue on a
     * lock, so each change is strictly newer than the one before.
     */
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      "rule_change_summary_length",
      sql`char_length(${t.summary}) between 1 and 200`,
    ),
    check(
      "rule_change_has_changes",
      sql`jsonb_typeof(${t.changes}) = 'array' and jsonb_array_length(${t.changes}) > 0`,
    ),
    index("rule_change_league_created_idx").on(t.leagueId, t.createdAt),
  ],
);

export type RuleSection = typeof ruleSection.$inferSelect;
export type RuleChange = typeof ruleChange.$inferSelect;
