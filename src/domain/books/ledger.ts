/**
 * The owners' ledger for one season (ADR 0034): money in, money out and
 * what is left. Pure: the queries pass the season's rows and this adds them
 * up, so the totals are tested without a database.
 *
 * Money in is what the app already records, never a call to Stripe:
 * - payments taken in the app (Stripe Checkout or a saved card),
 * - payments recorded outside the app (cash, Venmo, other),
 * - less what was refunded on either.
 * League credit spent at checkout is shown beside it but is not money in:
 * the league gave that credit earlier, so counting it would count it twice.
 *
 * Money out is the owners' expenses by category, plus each permit window's
 * share of its permit's cost, under "Fields and permits".
 */

export const EXPENSE_CATEGORIES = [
  "fields_permits",
  "equipment",
  "shirts",
  "refs",
  "events",
  "sponsor_costs",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<ExpenseCategory, string>> = {
  fields_permits: "Fields and permits",
  equipment: "Equipment",
  shirts: "Shirts",
  refs: "Refs",
  events: "Events",
  sponsor_costs: "Sponsor costs",
  other: "Other",
};

export type PaymentMethod = "stripe" | "cash" | "venmo" | "other";

export type LedgerPayment = {
  method: PaymentMethod;
  amountCents: number;
  refundedCents: number;
};

export type LedgerExpense = { category: ExpenseCategory; amountCents: number };

export type LedgerInput = {
  payments: readonly LedgerPayment[];
  /** League credit spent on this season's paid purchases. */
  creditAppliedCents: number;
  expenses: readonly LedgerExpense[];
  /** The permit windows' cost shares for the season. */
  permitCostCents: readonly number[];
};

export type Ledger = {
  income: {
    inAppCents: number;
    offAppCents: number;
    /** Refunded on either, as a positive number taken off. */
    refundsCents: number;
    totalCents: number;
    creditAppliedCents: number;
  };
  /** Every category in order, zero when nothing was spent on it. */
  expenses: { category: ExpenseCategory; label: string; cents: number }[];
  /** The permit cost already inside "Fields and permits". */
  permitCostCents: number;
  expenseTotalCents: number;
  netCents: number;
};

const sum = (values: readonly number[]) =>
  values.reduce((total, v) => total + v, 0);

export function buildLedger(input: LedgerInput): Ledger {
  const inAppCents = sum(
    input.payments.filter((p) => p.method === "stripe").map((p) => p.amountCents),
  );
  const offAppCents = sum(
    input.payments.filter((p) => p.method !== "stripe").map((p) => p.amountCents),
  );
  const refundsCents = sum(input.payments.map((p) => p.refundedCents));
  const totalIn = inAppCents + offAppCents - refundsCents;
  const permitCostCents = sum(input.permitCostCents);
  const expenses = EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    cents:
      sum(
        input.expenses
          .filter((e) => e.category === category)
          .map((e) => e.amountCents),
      ) + (category === "fields_permits" ? permitCostCents : 0),
  }));
  const expenseTotalCents = sum(expenses.map((e) => e.cents));
  return {
    income: {
      inAppCents,
      offAppCents,
      refundsCents,
      totalCents: totalIn,
      creditAppliedCents: input.creditAppliedCents,
    },
    expenses,
    permitCostCents,
    expenseTotalCents,
    netCents: totalIn - expenseTotalCents,
  };
}

/** "$1,250.00", "−$40.00": always cents, with a true minus sign. */
export function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `−$${text}` : `$${text}`;
}

/**
 * Splits a permit's cost across its windows so the shares add up to it
 * exactly: an even share each, and the leftover cents one each to the
 * earliest windows.
 */
export function splitCost(totalCents: number, windows: number): number[] {
  if (windows <= 0) return [];
  const base = Math.floor(totalCents / windows);
  const left = totalCents - base * windows;
  return Array.from({ length: windows }, (_, i) => base + (i < left ? 1 : 0));
}
