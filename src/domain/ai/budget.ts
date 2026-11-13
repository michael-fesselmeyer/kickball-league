/**
 * Whether an AI feature can run right now. The features are optional and
 * cost money per use, so they show only when every condition holds:
 * an API key is configured, the operator left the feature on, and the
 * month's spend leaves room for one more call at its worst case. The
 * budget is per calendar month in UTC, the way the provider bills.
 * See ADR 0013.
 *
 * Pure: the caller passes the clock and the numbers.
 */

export const DEFAULT_MONTHLY_BUDGET_CENTS = 500;
/** The highest budget the operator can set: $1,000 a month. */
export const MAX_MONTHLY_BUDGET_CENTS = 100_000;

export const centsToMicrodollars = (cents: number) => cents * 10_000;

/** The first moment of `now`'s month, in UTC. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The first moment of the month after `now`'s, in UTC. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type AiAvailability =
  /** No key, or the operator switched the feature off: show nothing. */
  | { kind: "hidden" }
  /** The month's budget is used up: say so, and when it comes back. */
  | { kind: "over_budget"; resumesOn: Date; spentMicrodollars: number }
  | { kind: "ready"; spentMicrodollars: number; budgetMicrodollars: number };

export function aiAvailability(input: {
  configured: boolean;
  featureOn: boolean;
  budgetCents: number;
  spentMicrodollars: number;
  /** The most the next call could cost. */
  worstCaseMicrodollars: number;
  now: Date;
}): AiAvailability {
  if (!input.configured || !input.featureOn) return { kind: "hidden" };
  const budget = centsToMicrodollars(input.budgetCents);
  if (input.spentMicrodollars + input.worstCaseMicrodollars > budget)
    return {
      kind: "over_budget",
      resumesOn: nextMonthStart(input.now),
      spentMicrodollars: input.spentMicrodollars,
    };
  return {
    kind: "ready",
    spentMicrodollars: input.spentMicrodollars,
    budgetMicrodollars: budget,
  };
}

/** Reads a budget in dollars from a form, such as "5" or "12.50". */
export function parseBudgetDollars(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents <= MAX_MONTHLY_BUDGET_CENTS ? cents : null;
}
