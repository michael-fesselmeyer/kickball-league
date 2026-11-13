import { isOneOf } from "../guards";
import { dollarsToCents } from "../money/credit";
import { err, ok, type Result } from "../result";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./ledger";

/**
 * Reads the owners' forms. Each returns the first problem by name, which
 * the page turns into words beside the form.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export type ExpenseForm = {
  spentOn: string;
  amountCents: number;
  category: ExpenseCategory;
  note: string;
};

export function parseExpenseForm(form: {
  spentOn: string;
  amount: string;
  category: string;
  note: string;
}): Result<ExpenseForm, "date" | "amount" | "category" | "note"> {
  if (!isDate(form.spentOn)) return err("date");
  const amountCents = dollarsToCents(form.amount);
  if (amountCents === null || amountCents <= 0) return err("amount");
  if (!isOneOf(EXPENSE_CATEGORIES, form.category)) return err("category");
  const note = form.note.trim();
  if (note.length > 200) return err("note");
  return ok({ spentOn: form.spentOn, amountCents, category: form.category, note });
}

/** An optional date field: empty is null, anything else must be a date. */
export function optionalDate(value: string): Result<string | null, "date"> {
  const trimmed = value.trim();
  if (trimmed === "") return ok(null);
  return isDate(trimmed) ? ok(trimmed) : err("date");
}

/** An optional dollar amount: empty is null. */
export function optionalCents(value: string): Result<number | null, "amount"> {
  if (value.trim() === "") return ok(null);
  const cents = dollarsToCents(value);
  return cents === null ? err("amount") : ok(cents);
}
