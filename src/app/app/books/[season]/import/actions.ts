"use server";

import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  type ImportRow,
  importStatementRows,
  type PreviewRow,
  previewStatement,
  removeMerchantRule,
  saveMerchantRule,
} from "@/db/queries/books-upkeep";
import { isDay } from "@/domain/books/forms";
import { EXPENSE_CATEGORIES } from "@/domain/books/ledger";
import {
  decodeStatement,
  readStatement,
  rulePattern,
  STATEMENT_MAX_BYTES,
  STATEMENT_MAX_ROWS,
  type StatementProblem,
  type StatementSource,
} from "@/domain/books/statement";
import { isOneOf } from "@/domain/guards";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshOwnerDashboard } from "@/lib/owner-dashboard-cache";
import { booksSeason, text, upload } from "../../load";

const pageFor = (slug: string) => `/app/books/${slug}/import`;

export type PreviewState =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | {
      kind: "preview";
      source: StatementSource;
      rows: PreviewRow[];
      moneyIn: number;
      transfers: number;
      unreadable: number;
      overLimit: number;
    };

const PROBLEMS: Record<StatementProblem | "no_file", string> = {
  no_file: "Choose the CSV file you downloaded.",
  empty: "That file is empty.",
  too_big: "That file is over 512 KB. Download a shorter date range.",
  unrecognized:
    "That doesn't look like a Venmo statement or a bank's CSV export. It needs a date column, an amount (or debit) column and a description.",
};

/**
 * Reads the statement and shows what would be imported. Nothing is saved:
 * the file is read in memory and dropped.
 */
export async function previewImportAction(
  slug: string,
  _previous: PreviewState,
  form: FormData,
): Promise<PreviewState> {
  await requirePermissionToChange("books.manage", { next: pageFor(slug) });
  const { league, season } = await booksSeason(slug);
  const file = upload(form, "statement");
  if (!file) return { kind: "error", message: PROBLEMS.no_file };
  if (file.size > STATEMENT_MAX_BYTES)
    return { kind: "error", message: PROBLEMS.too_big };
  const read = readStatement(
    decodeStatement(new Uint8Array(await file.arrayBuffer())),
  );
  if (!read.ok) return { kind: "error", message: PROBLEMS[read.error] };
  const rows = await previewStatement(db, {
    leagueId: league.id,
    rows: read.value.rows,
    season,
  });
  return {
    kind: "preview",
    source: read.value.source,
    rows,
    moneyIn: read.value.moneyIn,
    transfers: read.value.transfers,
    unreadable: read.value.unreadable,
    overLimit: read.value.overLimit,
  };
}

/** Rows come back from the page, so each is checked again here. */
function pickedRows(form: FormData): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const value of form.getAll("row").slice(0, STATEMENT_MAX_ROWS)) {
    if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) continue;
    const spentOn = text(form, `spentOn-${value}`);
    const amountCents = Number(text(form, `amount-${value}`));
    const key = text(form, `key-${value}`);
    const category = text(form, `category-${value}`);
    if (
      !isDay(spentOn) ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > 100_000_000 ||
      key === "" ||
      key.length > 300 ||
      !isOneOf(EXPENSE_CATEGORIES, category)
    )
      continue;
    rows.push({
      spentOn,
      amountCents,
      key,
      category,
      description: text(form, `description-${value}`),
    });
  }
  return rows;
}

export async function importRowsAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league, season } = await booksSeason(slug);
  const result = await txDb.transaction((tx) =>
    importStatementRows(
      tx,
      { leagueId: league.id, seasonId: season.id, rows: pickedRows(form) },
      subject.userId,
    ),
  );
  if (!result.ok)
    redirect(`${pageFor(slug)}?error=${result.error}#rules-heading`);
  refreshOwnerDashboard();
  const { imported, skipped } = result.value;
  redirect(
    `/app/books/${slug}?${new URLSearchParams({
      notice: "imported",
      imported: String(imported),
      skipped: String(skipped),
    }).toString()}#expenses`,
  );
}

export async function saveRuleAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const pattern = rulePattern(text(form, "pattern"));
  const category = text(form, "category");
  if (!pattern.ok) redirect(`${pageFor(slug)}?error=pattern#rules-heading`);
  if (!isOneOf(EXPENSE_CATEGORIES, category))
    redirect(`${pageFor(slug)}?error=category#rules-heading`);
  await txDb.transaction((tx) =>
    saveMerchantRule(
      tx,
      { leagueId: league.id, pattern: pattern.value, category },
      subject.userId,
    ),
  );
  redirect(`${pageFor(slug)}?notice=rule_saved#rules-heading`);
}

export async function removeRuleAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const result = await txDb.transaction((tx) =>
    removeMerchantRule(
      tx,
      { leagueId: league.id, pattern: text(form, "pattern") },
      subject.userId,
    ),
  );
  redirect(
    `${pageFor(slug)}?${result.ok ? "notice=rule_removed" : "error=unknown_rule"}#rules-heading`,
  );
}
