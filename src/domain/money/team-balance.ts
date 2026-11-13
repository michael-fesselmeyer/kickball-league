import { type PricedSeason, priceFor } from "../registration/pricing";

/**
 * A split-pay team's balance (docs/data-model.md, section 2.3): its fee
 * minus what has been paid toward it. Computed, never stored.
 *
 * The fee is the whole-team price on the day the team registered, so an
 * early-bird team keeps its early-bird fee. Shares are rounded up to the
 * dollar, so a full roster of shares can cover a little more than the fee.
 */
export function teamFeeCents(
  season: PricedSeason,
  registeredAt: Date,
): number | null {
  const price = priceFor(
    season,
    { kind: "captain", paymentMode: "full", rosterSize: 1 },
    registeredAt,
  );
  return price.ok ? price.cents : null;
}

/** What is still owed: never below zero. */
export function teamBalanceCents(feeCents: number, paidCents: number): number {
  return Math.max(0, feeCents - paidCents);
}
