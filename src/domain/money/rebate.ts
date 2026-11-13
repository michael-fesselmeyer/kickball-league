/**
 * The season rebate tool (product-spec.md, "Season rebate tool"; open
 * question 11). When more than a threshold share of a team's regular games
 * are lost and not made up, the team gets back that share of what was paid
 * for it, as league credit. Pure.
 */

/** Assumed until the owners decide (open-questions.md, question 11). */
export const DEFAULT_REBATE_THRESHOLD_PCT = 25;

export type GameForRebate = {
  status: string;
  /** Placed in a slot in the published schedule. */
  placed: boolean;
  /** That slot was cancelled, such as by a rain-out. */
  slotCancelled: boolean;
};

/**
 * A game is lost when it was cancelled or postponed, or it sits in the
 * published schedule with no slot ("makeup to be scheduled") or in a
 * cancelled one. A game moved to a makeup slot is not lost.
 */
export function isGameLost(g: GameForRebate): boolean {
  if (g.status === "cancelled" || g.status === "postponed") return true;
  if (g.status === "final" || g.status === "forfeit") return false;
  return !g.placed || g.slotCancelled;
}

export type RebateQuote = {
  lostPct: number;
  /** More than the threshold was lost. */
  eligible: boolean;
  /** The share of what was paid that comes back, rounded down to the cent. */
  rebateCents: number;
};

export function quoteRebate(input: {
  gamesCount: number;
  gamesLost: number;
  paidCents: number;
  thresholdPct: number;
}): RebateQuote {
  const { gamesCount, gamesLost, paidCents, thresholdPct } = input;
  if (gamesCount <= 0 || gamesLost <= 0)
    return { lostPct: 0, eligible: false, rebateCents: 0 };
  const lost = Math.min(gamesLost, gamesCount);
  const lostPct = (lost * 100) / gamesCount;
  const eligible = lostPct > thresholdPct;
  const rebateCents = eligible
    ? Math.floor((Math.max(0, paidCents) * lost) / gamesCount)
    : 0;
  return { lostPct, eligible, rebateCents };
}

export type Payer = { userId: string; paidCents: number };

/**
 * Splits a rebate among the people who paid for the team, in proportion to
 * what each paid. The parts add up to the rebate exactly; cents lost to
 * rounding go to the largest payers first. Payers who paid nothing get
 * nothing.
 */
export function splitRebate(
  rebateCents: number,
  payers: readonly Payer[],
): { userId: string; cents: number }[] {
  const paid = payers.filter((p) => p.paidCents > 0);
  const total = paid.reduce((sum, p) => sum + p.paidCents, 0);
  if (rebateCents <= 0 || total === 0) return [];
  const amount = Math.min(rebateCents, total);
  const parts = paid.map((p) => Math.floor((p.paidCents * amount) / total));
  let left = amount - parts.reduce((sum, c) => sum + c, 0);
  const order = paid
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.paidCents - a.p.paidCents || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left -= 1;
  }
  return paid
    .map((p, i) => ({ userId: p.userId, cents: parts[i] ?? 0 }))
    .filter((p) => p.cents > 0);
}
