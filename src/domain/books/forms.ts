import { isOneOf } from "../guards";
import { dollarsToCents } from "../money/credit";
import { err, ok, type Result } from "../result";
import { type Cadence, CADENCES } from "./expected";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./ledger";

/**
 * Reads the owners' forms. Each returns the first problem by name, which
 * the page turns into words beside the form.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real day: "2026-02-30" is refused rather than read as March 2. */
const isDate = (value: string) => {
  if (!DATE.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
};

/**
 * Dollars as an owner types them: "45", "45.5", "$1,200" or " 12.30 ".
 * Read as text, never floating point; null when it isn't an amount.
 */
export function typedCents(raw: string): number | null {
  return dollarsToCents(raw.replace(/[\s,$]/g, ""));
}

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
  const amountCents = typedCents(form.amount);
  if (amountCents === null || amountCents <= 0) return err("amount");
  if (!isOneOf(EXPENSE_CATEGORIES, form.category)) return err("category");
  const note = form.note.trim();
  if (note.length > 200) return err("note");
  return ok({
    spentOn: form.spentOn,
    amountCents,
    category: form.category,
    note,
  });
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
  const cents = typedCents(value);
  return cents === null ? err("amount") : ok(cents);
}

/** How an expense's receipt stands when it is added (ADR 0059). */
export const RECEIPT_CHOICES = ["later", "none", "now"] as const;
export type ReceiptChoice = (typeof RECEIPT_CHOICES)[number];

/** "later" unless the form says otherwise; a chosen photo wins anyway. */
export function receiptChoice(value: string): ReceiptChoice {
  return isOneOf(RECEIPT_CHOICES, value) ? value : "later";
}

/** Longest label for an expected cost. */
export const LABEL_MAX = 80;

export type RecurringForm = {
  label: string;
  amountCents: number;
  category: ExpenseCategory;
  cadence: Cadence;
  startsOn: string;
};

export function parseRecurringForm(form: {
  label: string;
  amount: string;
  category: string;
  cadence: string;
  startsOn: string;
}): Result<
  RecurringForm,
  "label" | "amount" | "category" | "cadence" | "date"
> {
  const label = form.label.replace(/\s+/g, " ").trim();
  if (label.length === 0 || label.length > LABEL_MAX) return err("label");
  const amountCents = typedCents(form.amount);
  if (amountCents === null || amountCents <= 0) return err("amount");
  if (!isOneOf(EXPENSE_CATEGORIES, form.category)) return err("category");
  if (!isOneOf(CADENCES, form.cadence)) return err("cadence");
  if (!isDate(form.startsOn)) return err("date");
  return ok({
    label,
    amountCents,
    category: form.category,
    cadence: form.cadence,
    startsOn: form.startsOn,
  });
}

/** A positive dollar amount, as for confirming an expected cost. */
export function parseAmount(value: string): Result<number, "amount"> {
  const cents = typedCents(value);
  return cents === null || cents <= 0 ? err("amount") : ok(cents);
}

/** YYYY-MM-DD that is a real day. */
export const isDay = isDate;
