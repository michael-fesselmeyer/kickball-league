"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { addExpense, removeExpense } from "@/db/queries/books";
import {
  attachReceipt,
  confirmExpected,
  markNoReceipt,
  reimburse,
  skipExpected,
} from "@/db/queries/books-upkeep";
import { localDate } from "@/domain/books/ledger-csv";
import {
  isDay,
  parseAmount,
  parseExpenseForm,
  receiptChoice,
} from "@/domain/books/forms";
import {
  type ExpenseId,
  parseId,
  type RecurringCostId,
  type UserId,
} from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { prepareUpload } from "@/lib/books/store-file";
import { refreshOwnerDashboard } from "@/lib/owner-dashboard-cache";
import { booksSeason, text, upload } from "../load";

const pageFor = (slug: string) => `/app/books/${slug}`;

function back(
  slug: string,
  query: Record<string, string>,
  at = "expenses",
): never {
  redirect(`${pageFor(slug)}?${new URLSearchParams(query).toString()}#${at}`);
}

/** "League money" is an empty value; anything else names who paid. */
function payer(form: FormData): UserId | null | "bad" {
  const value = text(form, "paidBy");
  if (value === "") return null;
  return parseId<UserId>(value) ?? "bad";
}

export async function addExpenseAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league, season } = await booksSeason(slug);
  const parsed = parseExpenseForm({
    spentOn: text(form, "spentOn") || localDate(new Date(), league.timeZone),
    amount: text(form, "amount"),
    category: text(form, "category"),
    note: text(form, "note"),
  });
  if (!parsed.ok) back(slug, { error: parsed.error }, "quick-add");
  const paidBy = payer(form);
  if (paidBy === "bad") back(slug, { error: "unknown_payer" }, "quick-add");
  const file = upload(form, "receipt");
  let receipt = null;
  if (file) {
    const prepared = await prepareUpload(file);
    if (!prepared.ok) back(slug, { error: prepared.error }, "quick-add");
    receipt = prepared.value;
  }
  const result = await txDb.transaction((tx) =>
    addExpense(
      tx,
      {
        leagueId: league.id,
        seasonId: season.id,
        ...parsed.value,
        receipt,
        noReceipt: receiptChoice(text(form, "receiptChoice")) === "none",
        paidBy,
      },
      subject.userId,
    ),
  );
  if (!result.ok) back(slug, { error: result.error }, "quick-add");
  refreshOwnerDashboard();
  back(slug, { notice: "added" }, "quick-add");
}

export async function removeExpenseAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const expenseId = parseId<ExpenseId>(text(form, "expenseId"));
  if (!expenseId) back(slug, { error: "unknown_expense" });
  const result = await txDb.transaction((tx) =>
    removeExpense(tx, { leagueId: league.id, expenseId }, subject.userId),
  );
  if (!result.ok) back(slug, { error: result.error });
  refreshOwnerDashboard();
  back(slug, { notice: "removed" });
}

export async function attachReceiptAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const expenseId = parseId<ExpenseId>(text(form, "expenseId"));
  if (!expenseId) back(slug, { error: "unknown_expense" });
  const file = upload(form, "receipt");
  if (!file) back(slug, { error: "no_file" });
  const prepared = await prepareUpload(file);
  if (!prepared.ok) back(slug, { error: prepared.error });
  const result = await txDb.transaction((tx) =>
    attachReceipt(
      tx,
      { leagueId: league.id, expenseId, receipt: prepared.value },
      subject.userId,
    ),
  );
  if (!result.ok) back(slug, { error: result.error });
  back(slug, { notice: "receipt" });
}

export async function noReceiptAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const expenseId = parseId<ExpenseId>(text(form, "expenseId"));
  if (!expenseId) back(slug, { error: "unknown_expense" });
  const result = await txDb.transaction((tx) =>
    markNoReceipt(tx, { leagueId: league.id, expenseId }, subject.userId),
  );
  if (!result.ok) back(slug, { error: result.error });
  back(slug, { notice: "no_receipt" });
}

/** The expected cost a confirm or skip form is about. */
async function occurrenceOf(slug: string, form: FormData) {
  const { league, season } = await booksSeason(slug);
  const costId = parseId<RecurringCostId>(text(form, "costId"));
  const dueOn = text(form, "dueOn");
  if (!costId || !isDay(dueOn))
    back(slug, { error: "not_expected" }, "expected");
  return {
    leagueId: league.id,
    season,
    timeZone: league.timeZone,
    today: localDate(new Date(), league.timeZone),
    costId,
    dueOn,
  };
}

export async function confirmExpectedAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const occurrence = await occurrenceOf(slug, form);
  const amount = parseAmount(text(form, "amount"));
  if (!amount.ok) back(slug, { error: "amount" }, "expected");
  const paidBy = payer(form);
  if (paidBy === "bad") back(slug, { error: "unknown_payer" }, "expected");
  const result = await txDb.transaction((tx) =>
    confirmExpected(
      tx,
      { ...occurrence, amountCents: amount.value, paidBy },
      subject.userId,
    ),
  );
  if (!result.ok) back(slug, { error: result.error }, "expected");
  refreshOwnerDashboard();
  back(slug, { notice: "confirmed" }, "expected");
}

export async function skipExpectedAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const occurrence = await occurrenceOf(slug, form);
  const result = await txDb.transaction((tx) =>
    skipExpected(tx, occurrence, subject.userId),
  );
  if (!result.ok) back(slug, { error: result.error }, "expected");
  back(slug, { notice: "skipped" }, "expected");
}

export async function reimburseAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league } = await booksSeason(slug);
  const paidBy = parseId<UserId>(text(form, "paidBy"));
  const expenseIds = text(form, "expenseIds")
    .split(",")
    .map((id) => parseId<ExpenseId>(id))
    .filter((id): id is ExpenseId => id !== null);
  if (!paidBy) back(slug, { error: "nothing_owed" }, "owed");
  const result = await txDb.transaction((tx) =>
    reimburse(
      tx,
      { leagueId: league.id, paidBy, expenseIds },
      subject.userId,
      new Date(),
    ),
  );
  if (!result.ok) back(slug, { error: result.error }, "owed");
  back(slug, { notice: "reimbursed" }, "owed");
}
