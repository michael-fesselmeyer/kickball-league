import { createHash } from "node:crypto";
import {
  and,
  asc,
  between,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  type Expected,
  expectedCosts,
  occurrenceKey,
  type Cadence,
} from "@/domain/books/expected";
import type { FileProblem } from "@/domain/books/files";
import { CATEGORY_LABELS, type ExpenseCategory } from "@/domain/books/ledger";
import {
  cleanDescription,
  guessCategory,
  looksLikeTransfer,
  type MerchantRule,
  type StatementRow,
} from "@/domain/books/statement";
import { nudgeKey, nudgeMonth, owedByPerson } from "@/domain/books/upkeep";
import type {
  BooksFileId,
  ExpenseId,
  LeagueId,
  RecurringCostId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { BooksNudgePayload } from "@/emails/books-nudge";
import type { PreparedFile } from "@/lib/books/store-file";
import { user } from "../schema/auth";
import {
  expense,
  merchantRule,
  recurringCost,
  recurringCostSkip,
} from "../schema/books";
import { game, slot } from "../schema/game";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { recordAudit } from "./audit";
import { addExpense, ownerIds, storeFile } from "./books";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Keeping the owners' books up to date (ADR 0054): quick add, receipts
 * added later, expected costs, out-of-pocket reimbursements, statement
 * imports and the monthly nudge. Pages check `books.manage` first, as for
 * the rest of the books (src/db/queries/books.ts); every change is audited
 * as `books.*`.
 */

const personName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${profile.firstName}, ${profile.lastName})), ''), ${user.name})`;

/** The owners, by name, for "who paid" and "who is owed". */
export async function ownersByName(db: Db, leagueId: LeagueId) {
  const ids = await ownerIds(db, leagueId);
  if (ids.length === 0) return [];
  return db
    .select({ userId: user.id, name: personName })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(inArray(user.id, ids))
    .orderBy(asc(personName));
}

/** The category of the league's newest expense, which quick add preselects. */
export async function lastCategory(
  db: Db,
  leagueId: LeagueId,
): Promise<ExpenseCategory | null> {
  const [row] = await db
    .select({ category: expense.category })
    .from(expense)
    .innerJoin(season, eq(season.id, expense.seasonId))
    .where(
      and(
        eq(season.leagueId, leagueId),
        // Typed by an owner: not an imported row or a confirmed expected cost.
        isNull(expense.importKey),
        isNull(expense.recurringCostId),
      ),
    )
    .orderBy(desc(expense.createdAt), desc(expense.id))
    .limit(1);
  return row?.category ?? null;
}

async function expenseInLeague(
  db: Db,
  leagueId: LeagueId,
  expenseId: ExpenseId,
) {
  const [found] = await db
    .select({
      id: expense.id,
      receiptFileId: expense.receiptFileId,
      seasonId: expense.seasonId,
    })
    .from(expense)
    .innerJoin(season, eq(season.id, expense.seasonId))
    .where(and(eq(expense.id, expenseId), eq(season.leagueId, leagueId)));
  return found ?? null;
}

// ---------------------------------------------------------------------------
// Receipts after the fact

/** Attaches a receipt to an expense that has none. */
export async function attachReceipt(
  db: Db,
  input: {
    leagueId: LeagueId;
    expenseId: ExpenseId;
    receipt: PreparedFile;
    cap?: number;
  },
  actorId: UserId,
): Promise<
  Result<BooksFileId, FileProblem | "unknown_expense" | "has_receipt">
> {
  const found = await expenseInLeague(db, input.leagueId, input.expenseId);
  if (!found) return err("unknown_expense");
  if (found.receiptFileId) return err("has_receipt");
  const stored = await storeFile(
    db,
    {
      leagueId: input.leagueId,
      kind: "receipt",
      file: input.receipt,
      cap: input.cap,
    },
    actorId,
  );
  if (!stored.ok) return stored;
  await db
    .update(expense)
    .set({ receiptFileId: stored.value, noReceipt: false })
    .where(eq(expense.id, input.expenseId));
  await recordAudit(db, {
    actorId,
    action: "books.receipt_add",
    entityType: "expense",
    entityId: input.expenseId,
    after: { receiptFileId: stored.value },
  });
  return ok(stored.value);
}

/** Records that an expense has no receipt, so it stops counting as missing. */
export async function markNoReceipt(
  db: Db,
  input: { leagueId: LeagueId; expenseId: ExpenseId },
  actorId: UserId,
): Promise<Result<void, "unknown_expense" | "has_receipt">> {
  const found = await expenseInLeague(db, input.leagueId, input.expenseId);
  if (!found) return err("unknown_expense");
  if (found.receiptFileId) return err("has_receipt");
  await db
    .update(expense)
    .set({ noReceipt: true })
    .where(eq(expense.id, input.expenseId));
  await recordAudit(db, {
    actorId,
    action: "books.no_receipt",
    entityType: "expense",
    entityId: input.expenseId,
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Expected costs

/** The league's recurring costs still in use, oldest first. */
export async function recurringCosts(db: Db, leagueId: LeagueId) {
  return db
    .select({
      id: recurringCost.id,
      label: recurringCost.label,
      category: recurringCost.category,
      amountCents: recurringCost.amountCents,
      cadence: recurringCost.cadence,
      startsOn: recurringCost.startsOn,
    })
    .from(recurringCost)
    .where(
      and(
        eq(recurringCost.leagueId, leagueId),
        isNull(recurringCost.archivedAt),
      ),
    )
    .orderBy(asc(recurringCost.createdAt), asc(recurringCost.id));
}

export type RecurringCostInput = {
  leagueId: LeagueId;
  label: string;
  category: ExpenseCategory;
  amountCents: number;
  cadence: Cadence;
  startsOn: string;
};

export async function addRecurringCost(
  db: Db,
  input: RecurringCostInput,
  actorId: UserId,
): Promise<RecurringCostId> {
  const [created] = await db
    .insert(recurringCost)
    .values({ ...input, createdBy: actorId })
    .returning({ id: recurringCost.id });
  if (!created) throw new Error("recurring cost not created");
  await recordAudit(db, {
    actorId,
    action: "books.recurring_add",
    entityType: "recurring_cost",
    entityId: created.id,
    after: {
      label: input.label,
      category: input.category,
      amountCents: input.amountCents,
      cadence: input.cadence,
      startsOn: input.startsOn,
    },
  });
  return created.id;
}

/** Stops expecting a cost. Expenses it settled keep their link. */
export async function archiveRecurringCost(
  db: Db,
  input: { leagueId: LeagueId; costId: RecurringCostId },
  actorId: UserId,
  now: Date,
): Promise<Result<void, "unknown_cost">> {
  const [archived] = await db
    .update(recurringCost)
    .set({ archivedAt: now })
    .where(
      and(
        eq(recurringCost.id, input.costId),
        eq(recurringCost.leagueId, input.leagueId),
        isNull(recurringCost.archivedAt),
      ),
    )
    .returning({ label: recurringCost.label });
  if (!archived) return err("unknown_cost");
  await recordAudit(db, {
    actorId,
    action: "books.recurring_remove",
    entityType: "recurring_cost",
    entityId: input.costId,
    before: archived,
  });
  return ok(undefined);
}

/** The season's game days in the league's time zone, played or still to come. */
async function gameDaysOf(db: Db, seasonId: SeasonId, timeZone: string) {
  const day = sql<string>`((${slot.startsAt} at time zone ${timeZone})::date)::text`;
  const rows = await db
    .selectDistinct({ day })
    .from(game)
    .innerJoin(slot, eq(slot.id, game.slotId))
    .where(
      and(
        eq(game.seasonId, seasonId),
        notInArray(game.status, ["cancelled", "postponed"]),
      ),
    );
  return rows.map((r) => r.day);
}

export type ExpectedSeason = {
  id: SeasonId;
  startsOn: string;
  endsOn: string;
};

/** The season's expected costs, due and next, from three parallel reads. */
export async function seasonExpected(
  db: Db,
  input: {
    leagueId: LeagueId;
    season: ExpectedSeason;
    timeZone: string;
    today: string;
  },
): Promise<Expected> {
  const [costs, gameDays, confirmed, skipped] = await Promise.all([
    recurringCosts(db, input.leagueId),
    gameDaysOf(db, input.season.id, input.timeZone),
    db
      .select({ costId: expense.recurringCostId, dueOn: expense.dueOn })
      .from(expense)
      .where(
        and(
          eq(expense.seasonId, input.season.id),
          isNotNull(expense.recurringCostId),
        ),
      ),
    db
      .select({
        costId: recurringCostSkip.recurringCostId,
        dueOn: recurringCostSkip.dueOn,
      })
      .from(recurringCostSkip)
      .where(eq(recurringCostSkip.seasonId, input.season.id)),
  ]);
  const settled = new Set(
    [...confirmed, ...skipped].flatMap((s) =>
      s.costId && s.dueOn
        ? [occurrenceKey({ costId: s.costId, dueOn: s.dueOn })]
        : [],
    ),
  );
  return expectedCosts({
    costs,
    season: input.season,
    gameDays,
    settled,
    today: input.today,
  });
}

type OccurrenceInput = {
  leagueId: LeagueId;
  season: ExpectedSeason;
  timeZone: string;
  today: string;
  costId: RecurringCostId;
  dueOn: string;
};

async function dueOccurrence(db: Db, input: OccurrenceInput) {
  const expected = await seasonExpected(db, input);
  return (
    expected.due.find(
      (o) => o.costId === input.costId && o.dueOn === input.dueOn,
    ) ?? null
  );
}

/**
 * Confirms an expected cost: adds it as an expense on its due day, at the
 * amount the owner confirmed. Only a due, unsettled occurrence can be
 * confirmed, so two owners tapping at once add it once.
 */
export async function confirmExpected(
  db: Db,
  input: OccurrenceInput & {
    amountCents: number;
    paidBy: UserId | null;
  },
  actorId: UserId,
): Promise<Result<ExpenseId, "not_expected" | "unknown_payer">> {
  const due = await dueOccurrence(db, input);
  if (!due) return err("not_expected");
  const added = await addExpense(
    db,
    {
      leagueId: input.leagueId,
      seasonId: input.season.id,
      spentOn: due.dueOn,
      amountCents: input.amountCents,
      category: due.category,
      note: due.label,
      receipt: null,
      paidBy: input.paidBy,
      occurrence: { recurringCostId: input.costId, dueOn: due.dueOn },
    },
    actorId,
  );
  if (!added.ok)
    return added.error === "unknown_payer"
      ? err("unknown_payer")
      : err("not_expected");
  return ok(added.value);
}

/** Skips an expected cost that won't be paid, such as a rained-out day. */
export async function skipExpected(
  db: Db,
  input: OccurrenceInput,
  actorId: UserId,
): Promise<Result<void, "not_expected">> {
  const due = await dueOccurrence(db, input);
  if (!due) return err("not_expected");
  const skipped = await db
    .insert(recurringCostSkip)
    .values({
      recurringCostId: input.costId,
      seasonId: input.season.id,
      dueOn: due.dueOn,
      skippedBy: actorId,
    })
    .onConflictDoNothing()
    .returning({ dueOn: recurringCostSkip.dueOn });
  if (skipped.length === 0) return err("not_expected");
  await recordAudit(db, {
    actorId,
    action: "books.expected_skip",
    entityType: "recurring_cost",
    entityId: input.costId,
    after: { dueOn: due.dueOn },
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Out of pocket

/** What each owner is owed for costs they paid themselves, across seasons. */
export async function owedList(db: Db, leagueId: LeagueId) {
  const rows = await db
    .select({
      id: expense.id,
      paidBy: expense.paidBy,
      amountCents: expense.amountCents,
    })
    .from(expense)
    .innerJoin(season, eq(season.id, expense.seasonId))
    .where(
      and(
        eq(season.leagueId, leagueId),
        isNotNull(expense.paidBy),
        isNull(expense.reimbursedAt),
      ),
    );
  const owed = owedByPerson(
    rows.flatMap((r) => (r.paidBy ? [{ ...r, paidBy: r.paidBy }] : [])),
  );
  if (owed.length === 0) return [];
  const names = await db
    .select({ userId: user.id, name: personName })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      inArray(
        user.id,
        owed.map((o) => o.paidBy as UserId),
      ),
    );
  const nameOf = new Map(names.map((n) => [n.userId as string, n.name]));
  return owed.map((o) => ({
    paidBy: o.paidBy as UserId,
    name: nameOf.get(o.paidBy) ?? "An owner",
    cents: o.cents,
    expenseIds: o.expenseIds as ExpenseId[],
  }));
}

/**
 * Marks what a person was owed as reimbursed: the expenses listed when the
 * owner pressed the button, so one added since stays owed.
 */
export async function reimburse(
  db: Db,
  input: { leagueId: LeagueId; paidBy: UserId; expenseIds: ExpenseId[] },
  actorId: UserId,
  now: Date,
): Promise<Result<number, "nothing_owed">> {
  if (input.expenseIds.length === 0) return err("nothing_owed");
  const leagueSeasons = db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.leagueId, input.leagueId));
  const cleared = await db
    .update(expense)
    .set({ reimbursedAt: now, reimbursedBy: actorId })
    .where(
      and(
        inArray(expense.id, input.expenseIds),
        eq(expense.paidBy, input.paidBy),
        isNull(expense.reimbursedAt),
        inArray(expense.seasonId, leagueSeasons),
      ),
    )
    .returning({ amountCents: expense.amountCents });
  if (cleared.length === 0) return err("nothing_owed");
  const cents = cleared.reduce((t, r) => t + r.amountCents, 0);
  await recordAudit(db, {
    actorId,
    action: "books.reimburse",
    entityType: "user",
    entityId: input.paidBy,
    after: { expenses: cleared.length, amountCents: cents },
  });
  return ok(cents);
}

// ---------------------------------------------------------------------------
// Statement import

/** The owners' merchant rules, as the guesser takes them. */
export async function merchantRules(
  db: Db,
  leagueId: LeagueId,
): Promise<MerchantRule[]> {
  return db
    .select({ pattern: merchantRule.pattern, category: merchantRule.category })
    .from(merchantRule)
    .where(eq(merchantRule.leagueId, leagueId))
    .orderBy(asc(merchantRule.pattern));
}

/** Adds a rule, or changes the category of the same pattern. */
export async function saveMerchantRule(
  db: Db,
  input: { leagueId: LeagueId; pattern: string; category: ExpenseCategory },
  actorId: UserId,
) {
  await db
    .insert(merchantRule)
    .values({ ...input, createdBy: actorId })
    .onConflictDoUpdate({
      target: [merchantRule.leagueId, merchantRule.pattern],
      set: { category: input.category },
    });
  await recordAudit(db, {
    actorId,
    action: "books.rule_save",
    entityType: "merchant_rule",
    entityId: input.pattern,
    after: { category: input.category },
  });
}

export async function removeMerchantRule(
  db: Db,
  input: { leagueId: LeagueId; pattern: string },
  actorId: UserId,
): Promise<Result<void, "unknown_rule">> {
  const removed = await db
    .delete(merchantRule)
    .where(
      and(
        eq(merchantRule.leagueId, input.leagueId),
        eq(merchantRule.pattern, input.pattern),
      ),
    )
    .returning({ category: merchantRule.category });
  if (removed.length === 0) return err("unknown_rule");
  await recordAudit(db, {
    actorId,
    action: "books.rule_remove",
    entityType: "merchant_rule",
    entityId: input.pattern,
  });
  return ok(undefined);
}

/** What is stored for a row's key: a hash, scoped to the league. */
export const importKeyOf = (leagueId: LeagueId, key: string) =>
  createHash("sha256").update(`${leagueId}|${key}`).digest("hex");

/** Days apart within which a hand-entered expense may be the same payment. */
export const MATCH_DAYS = 3;

export type PreviewRow = StatementRow & {
  category: ExpenseCategory | null;
  /**
   * Every status but `new` starts unticked:
   * - `imported`: already in from an earlier statement, so it's skipped.
   * - `maybe_entered`: an expense with the same amount was entered by
   *   hand within MATCH_DAYS.
   * - `transfer`: the description reads like money moving between accounts.
   * - `outside_season`: dated well outside the season being imported into,
   *   so a year's statement doesn't land in one season by accident.
   */
  status: "new" | "imported" | "maybe_entered" | "transfer" | "outside_season";
};

/**
 * How far outside a season's dates a row is still taken as one of its
 * costs: permits are often paid months ahead, the last bar tab a little
 * after.
 */
export const SEASON_BEFORE_DAYS = 120;
export const SEASON_AFTER_DAYS = 30;

const shift = (on: string, days: number) => {
  const d = new Date(`${on}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Guesses categories and finds the rows already in the books. */
export async function previewStatement(
  db: Db,
  input: {
    leagueId: LeagueId;
    rows: readonly StatementRow[];
    /** The season the rows would go into. */
    season?: { startsOn: string; endsOn: string };
  },
): Promise<PreviewRow[]> {
  if (input.rows.length === 0) return [];
  const keys = input.rows.map((r) => importKeyOf(input.leagueId, r.key));
  const dates = input.rows.map((r) => r.spentOn).sort();
  const from = shift(dates[0] ?? "", -MATCH_DAYS);
  const to = shift(dates.at(-1) ?? "", MATCH_DAYS);
  const [rules, imported, entered] = await Promise.all([
    merchantRules(db, input.leagueId),
    db
      .select({ key: expense.importKey })
      .from(expense)
      .innerJoin(season, eq(season.id, expense.seasonId))
      .where(
        and(
          eq(season.leagueId, input.leagueId),
          inArray(expense.importKey, keys),
        ),
      ),
    db
      .select({ spentOn: expense.spentOn, amountCents: expense.amountCents })
      .from(expense)
      .innerJoin(season, eq(season.id, expense.seasonId))
      .where(
        and(
          eq(season.leagueId, input.leagueId),
          isNull(expense.importKey),
          between(expense.spentOn, from, to),
        ),
      ),
  ]);
  const done = new Set(imported.map((r) => r.key));
  return input.rows.map((row, i) => {
    const near = entered.some(
      (e) =>
        e.amountCents === row.amountCents &&
        e.spentOn >= shift(row.spentOn, -MATCH_DAYS) &&
        e.spentOn <= shift(row.spentOn, MATCH_DAYS),
    );
    const outside =
      input.season !== undefined &&
      (row.spentOn < shift(input.season.startsOn, -SEASON_BEFORE_DAYS) ||
        row.spentOn > shift(input.season.endsOn, SEASON_AFTER_DAYS));
    const status: PreviewRow["status"] = done.has(keys[i] ?? "")
      ? "imported"
      : near
        ? "maybe_entered"
        : looksLikeTransfer(row.description)
          ? "transfer"
          : outside
            ? "outside_season"
            : "new";
    return {
      ...row,
      category: guessCategory(row.description, rules),
      status,
    };
  });
}

export type ImportRow = {
  spentOn: string;
  amountCents: number;
  description: string;
  key: string;
  category: ExpenseCategory;
};

/**
 * Adds the ticked rows as expenses in the season. A row whose key is
 * already in the league's books is skipped, so importing the same
 * statement twice adds nothing. The statement line stands in for a
 * receipt, so imported rows don't count as missing one.
 */
export async function importStatementRows(
  db: Db,
  input: { leagueId: LeagueId; seasonId: SeasonId; rows: readonly ImportRow[] },
  actorId: UserId,
): Promise<Result<{ imported: number; skipped: number }, "unknown_season">> {
  const [found] = await db
    .select({ id: season.id })
    .from(season)
    .where(
      and(eq(season.id, input.seasonId), eq(season.leagueId, input.leagueId)),
    );
  if (!found) return err("unknown_season");
  const keyed = input.rows.map((r) => ({
    ...r,
    importKey: importKeyOf(input.leagueId, r.key),
  }));
  if (keyed.length === 0) return ok({ imported: 0, skipped: 0 });
  const already = new Set(
    (
      await db
        .select({ key: expense.importKey })
        .from(expense)
        .innerJoin(season, eq(season.id, expense.seasonId))
        .where(
          and(
            eq(season.leagueId, input.leagueId),
            inArray(
              expense.importKey,
              keyed.map((r) => r.importKey),
            ),
          ),
        )
    ).map((r) => r.key),
  );
  const fresh = keyed.filter(
    (r, i) =>
      !already.has(r.importKey) &&
      keyed.findIndex((o) => o.importKey === r.importKey) === i,
  );
  const created =
    fresh.length === 0
      ? []
      : await db
          .insert(expense)
          .values(
            fresh.map((r) => ({
              seasonId: input.seasonId,
              spentOn: r.spentOn,
              amountCents: r.amountCents,
              category: r.category,
              note: cleanDescription(r.description) || null,
              importKey: r.importKey,
              createdBy: actorId,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: expense.id });
  const cents = fresh.reduce((t, r) => t + r.amountCents, 0);
  await recordAudit(db, {
    actorId,
    action: "books.import",
    entityType: "season",
    entityId: input.seasonId,
    after: {
      imported: created.length,
      skipped: input.rows.length - created.length,
      amountCents: cents,
    },
  });
  return ok({
    imported: created.length,
    skipped: input.rows.length - created.length,
  });
}

// ---------------------------------------------------------------------------
// The monthly nudge

/** Most entries of each kind the nudge lists; the rest are counted. */
export const NUDGE_LIST_MAX = 8;

/**
 * Queues the month's nudge for every owner, in the first week of a month,
 * when expected costs wait to be confirmed or expenses wait on a receipt in
 * a season that isn't over. Imported rows and confirmed expected costs
 * don't count as missing a receipt. Returns how many were new.
 */
export async function queueBooksNudge(
  db: Db,
  input: { leagueId: LeagueId; timeZone: string; today: string; now: Date },
): Promise<number> {
  const month = nudgeMonth(input.today);
  if (!month) return 0;
  const seasons = await db
    .select({
      id: season.id,
      slug: season.slug,
      name: season.name,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
    })
    .from(season)
    .where(
      and(eq(season.leagueId, input.leagueId), ne(season.status, "completed")),
    )
    .orderBy(asc(season.startsOn));
  if (seasons.length === 0) return 0;
  const [expectedBySeason, missing, owners] = await Promise.all([
    Promise.all(
      seasons.map((s) =>
        seasonExpected(db, {
          leagueId: input.leagueId,
          season: s,
          timeZone: input.timeZone,
          today: input.today,
        }),
      ),
    ),
    db
      .select({
        spentOn: expense.spentOn,
        amountCents: expense.amountCents,
        category: expense.category,
      })
      .from(expense)
      .where(
        and(
          inArray(
            expense.seasonId,
            seasons.map((s) => s.id),
          ),
          isNull(expense.receiptFileId),
          eq(expense.noReceipt, false),
          isNull(expense.importKey),
          isNull(expense.recurringCostId),
        ),
      )
      .orderBy(asc(expense.spentOn)),
    ownerIds(db, input.leagueId),
  ]);
  const due = expectedBySeason.flatMap((e) => e.due);
  if ((due.length === 0 && missing.length === 0) || owners.length === 0)
    return 0;
  const payload: BooksNudgePayload = {
    expected: due.slice(0, NUDGE_LIST_MAX).map((o) => ({
      label: o.label,
      dueOn: o.dueOn,
      amountCents: o.amountCents,
    })),
    expectedCount: due.length,
    receipts: missing.slice(0, NUDGE_LIST_MAX).map((m) => ({
      spentOn: m.spentOn,
      amountCents: m.amountCents,
      category: CATEGORY_LABELS[m.category],
    })),
    receiptsCount: missing.length,
  };
  return enqueueMessages(
    db,
    owners.map((userId) => ({
      userId,
      topic: "operations" as const,
      template: "books_nudge",
      payload,
      dedupeKey: nudgeKey(month, userId),
      sendAfter: input.now,
    })),
  );
}
