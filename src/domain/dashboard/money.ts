import {
  buildLedger,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type PaymentMethod,
} from "../books/ledger";

/**
 * Money by season for the owner dashboard, and the season money summary an
 * owner may publish (ADR 0038). Pure: the queries pass totals already added
 * up by season, and the books' own ledger (ADR 0034) turns them into money
 * in and money out, so the dashboard and the books always agree.
 */

/** What a purchase paid for: a registration fee, event tickets or merch. */
export type PurchaseKind = "registration" | "ticket" | "merch";

/** Succeeded payments of one season, added up by method and kind. */
export type PaymentTotals = {
  seasonId: string;
  method: PaymentMethod;
  /** What the purchase was for. */
  kind: PurchaseKind;
  amountCents: number;
  refundedCents: number;
};

export type ExpenseTotals = {
  seasonId: string;
  category: ExpenseCategory;
  amountCents: number;
};

export type SeasonMoney = {
  seasonId: string;
  /** Registrations paid in the app. */
  registrationsCents: number;
  /** Event tickets paid in the app. */
  ticketsCents: number;
  /** Merch (shirts, replacement jerseys) paid in the app. */
  merchCents: number;
  /** Cash, Venmo and other payments recorded by a captain or admin. */
  offAppCents: number;
  /** Given back on any of the above, as a positive number. */
  refundsCents: number;
  /** League credit spent at checkout: shown, not counted as money in. */
  creditCents: number;
  /** Money in: everything paid, less refunds. */
  incomeCents: number;
  expenses: { category: ExpenseCategory; label: string; cents: number }[];
  expenseTotalCents: number;
  netCents: number;
};

const sum = (values: readonly number[]) =>
  values.reduce((total, v) => total + v, 0);

/** Money in and out for one season, from its totals. */
export function seasonMoney(input: {
  seasonId: string;
  payments: readonly PaymentTotals[];
  creditCents: number;
  expenses: readonly ExpenseTotals[];
  permitCostCents: number;
}): SeasonMoney {
  const ledger = buildLedger({
    payments: input.payments,
    creditAppliedCents: input.creditCents,
    expenses: input.expenses,
    permitCostCents: [input.permitCostCents],
  });
  const inApp = input.payments.filter((p) => p.method === "stripe");
  return {
    seasonId: input.seasonId,
    registrationsCents: sum(
      inApp.filter((p) => p.kind === "registration").map((p) => p.amountCents),
    ),
    ticketsCents: sum(
      inApp.filter((p) => p.kind === "ticket").map((p) => p.amountCents),
    ),
    merchCents: sum(
      inApp.filter((p) => p.kind === "merch").map((p) => p.amountCents),
    ),
    offAppCents: ledger.income.offAppCents,
    refundsCents: ledger.income.refundsCents,
    creditCents: input.creditCents,
    incomeCents: ledger.income.totalCents,
    expenses: ledger.expenses,
    expenseTotalCents: ledger.expenseTotalCents,
    netCents: ledger.netCents,
  };
}

// ---------------------------------------------------------------------------
// The season money summary (ADR 0038)

/**
 * The fewest members a season needs before its summary can be published.
 * With fewer, the money collected could stand for one person's payment.
 */
export const MIN_MEMBERS_TO_PUBLISH = 10;

export type SummaryFee = { label: string; cents: number };

/**
 * What a published summary shows, saved as it was when the owner published
 * it. Category totals and fee shares only: no names, counts of people,
 * notes, dates of single payments or any one person's amount.
 */
export type MoneySummary = {
  /** Money in for the season, after refunds. */
  collectedCents: number;
  spentCents: number;
  /** What was collected and not spent; 0 when spending was higher. */
  unspentCents: number;
  /** Categories with money spent, largest first; folded ones are in "Other". */
  categories: { label: string; cents: number; share: number }[];
  /** How each of the season's fees divides across the same lines. */
  fees: {
    label: string;
    cents: number;
    parts: { label: string; cents: number }[];
  }[];
};

export const UNSPENT_LABEL = "Not spent yet";

/**
 * Splits `total` into whole cents in proportion to `weights`, so the parts
 * add up to it exactly: each gets its rounded-down share, and the cents left
 * over go to the largest remainders (ties to the earlier part).
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const whole = sum(weights);
  if (whole <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / whole);
  const parts = exact.map(Math.floor);
  let left = total - sum(parts);
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

/**
 * The summary for one season. Categories the owner folded join "Other",
 * which is how a total that would point at one person (one referee who
 * worked every game, say) stays private. Shares are of the money collected,
 * with what is not spent yet as its own line; when spending was higher than
 * the money collected, shares are of what was spent.
 */
export function buildMoneySummary(
  money: Pick<SeasonMoney, "incomeCents" | "expenses">,
  fees: readonly SummaryFee[],
  folded: readonly ExpenseCategory[],
): MoneySummary {
  const fold = new Set(folded);
  const totals = new Map<ExpenseCategory, number>();
  for (const e of money.expenses) {
    const key: ExpenseCategory = fold.has(e.category) ? "other" : e.category;
    totals.set(key, (totals.get(key) ?? 0) + Math.max(0, e.cents));
  }
  const lines = EXPENSE_CATEGORIES.flatMap((category) => {
    const cents = totals.get(category) ?? 0;
    return cents > 0 ? [{ label: CATEGORY_LABELS[category], cents }] : [];
  }).sort((a, b) => b.cents - a.cents);
  const collectedCents = Math.max(0, money.incomeCents);
  const spentCents = sum(lines.map((l) => l.cents));
  const unspentCents = Math.max(0, collectedCents - spentCents);
  const base = Math.max(collectedCents, spentCents);
  const withUnspent =
    unspentCents > 0
      ? [...lines, { label: UNSPENT_LABEL, cents: unspentCents }]
      : lines;
  return {
    collectedCents,
    spentCents,
    unspentCents,
    categories: lines.map((l) => ({
      ...l,
      share: base > 0 ? l.cents / base : 0,
    })),
    fees: fees
      .filter((f) => f.cents > 0)
      .map((f) => {
        const parts = apportion(
          f.cents,
          withUnspent.map((l) => l.cents),
        );
        return {
          ...f,
          parts: withUnspent
            .map((l, i) => ({ label: l.label, cents: parts[i] ?? 0 }))
            .filter((p) => p.cents > 0),
        };
      }),
  };
}

/** The fees a season charges, by name, for the "share of each fee" lines. */
export function seasonFees(s: {
  feeModel: "per_team" | "per_player";
  teamFeeCents: number | null;
  playerFeeCents: number | null;
  freeAgentFeeCents: number | null;
}): SummaryFee[] {
  const fees: SummaryFee[] = [];
  if (s.teamFeeCents) fees.push({ label: "Team fee", cents: s.teamFeeCents });
  if (s.feeModel === "per_player" && s.playerFeeCents)
    fees.push({ label: "Player fee", cents: s.playerFeeCents });
  if (s.freeAgentFeeCents)
    fees.push({ label: "Free agent fee", cents: s.freeAgentFeeCents });
  return fees;
}

/** Why a season's summary can't be published yet, or null when it can. */
export function publishBlocker(input: {
  members: number;
  summary: MoneySummary;
}): "too_few_members" | "no_money" | null {
  if (input.members < MIN_MEMBERS_TO_PUBLISH) return "too_few_members";
  if (input.summary.collectedCents === 0 && input.summary.spentCents === 0)
    return "no_money";
  return null;
}
