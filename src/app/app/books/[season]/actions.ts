"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { addExpense, removeExpense } from "@/db/queries/books";
import { parseExpenseForm } from "@/domain/books/forms";
import { type ExpenseId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { prepareUpload } from "@/lib/books/store-file";
import { booksSeason, text, upload } from "../load";

const pageFor = (slug: string) => `/app/books/${slug}`;

function back(slug: string, query: Record<string, string>): never {
  redirect(
    `${pageFor(slug)}?${new URLSearchParams(query).toString()}#expenses`,
  );
}

export async function addExpenseAction(slug: string, form: FormData) {
  const subject = await requirePermissionToChange("books.manage", {
    next: pageFor(slug),
  });
  const { league, season } = await booksSeason(slug);
  const parsed = parseExpenseForm({
    spentOn: text(form, "spentOn"),
    amount: text(form, "amount"),
    category: text(form, "category"),
    note: text(form, "note"),
  });
  if (!parsed.ok) back(slug, { error: parsed.error });
  const file = upload(form, "receipt");
  let receipt = null;
  if (file) {
    const prepared = await prepareUpload(file);
    if (!prepared.ok) back(slug, { error: prepared.error });
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
      },
      subject.userId,
    ),
  );
  if (!result.ok) back(slug, { error: result.error });
  back(slug, { notice: "added" });
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
  back(slug, { notice: "removed" });
}
