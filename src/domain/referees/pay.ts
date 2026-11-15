/**
 * The ref pay sheet for a season (ADR 0053). A ref is owed the season's
 * per-game fee for each game they worked: one they checked in for, or one
 * whose score they reported as its ref. Payouts are what owners or admins
 * marked as paid, in cash or by Venmo. Nothing is stored as "owed": it is
 * worked out here each time, so a change to the fee or a late check-in is
 * reflected at once.
 */

export const PAYOUT_METHODS = ["cash", "venmo"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYOUT_METHOD_LABELS: Readonly<Record<PayoutMethod, string>> = {
  cash: "Cash",
  venmo: "Venmo",
};

/** The most one payout or one game's fee can be: $1,000. */
export const MAX_PAY_CENTS = 100_000;

export type PayInput = {
  userId: string;
  name: string;
  gamesWorked: number;
  paidCents: number;
};

export type PayRow = PayInput & { owedCents: number; balanceCents: number };

/** Each ref's line, the ones still owed money first, then by name. */
export function paySheet(
  refs: readonly PayInput[],
  feeCents: number | null,
): PayRow[] {
  return refs
    .map((r) => {
      const owedCents = r.gamesWorked * (feeCents ?? 0);
      return { ...r, owedCents, balanceCents: owedCents - r.paidCents };
    })
    .sort(
      (a, b) =>
        Number(b.balanceCents > 0) - Number(a.balanceCents > 0) ||
        a.name.localeCompare(b.name),
    );
}

/** The sheet's totals. */
export function payTotals(rows: readonly PayRow[]) {
  return rows.reduce(
    (t, r) => ({
      gamesWorked: t.gamesWorked + r.gamesWorked,
      owedCents: t.owedCents + r.owedCents,
      paidCents: t.paidCents + r.paidCents,
      balanceCents: t.balanceCents + r.balanceCents,
    }),
    { gamesWorked: 0, owedCents: 0, paidCents: 0, balanceCents: 0 },
  );
}

/** Dollars as typed ("25", "25.50", "$25") in cents, or null. */
export function parseDollars(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^\$?\s*(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
  return cents <= MAX_PAY_CENTS ? cents : null;
}

/** Cents as dollars for a form field: 2550 is "25.50", 2500 is "25". */
export const dollarsField = (cents: number) =>
  cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
