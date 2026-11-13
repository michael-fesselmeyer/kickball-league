/**
 * The captain guarantee (product-spec.md, "Captain guarantee"; open
 * question 14). A captain of a split-pay team saves a card; the league warns
 * them 72 hours before the payment deadline and charges the card for the
 * unpaid balance at the deadline. Pure: the caller passes the times.
 *
 * The card is never charged without 72 hours' notice: if the warning went
 * out late (the card was saved inside the window, or the job missed a day),
 * the charge waits until 72 hours after the warning.
 */

export const WARNING_HOURS = 72;
const WARNING_MS = WARNING_HOURS * 3_600_000;

export type GuaranteeState = {
  deadline: Date | null;
  balanceCents: number;
  /** The deadline the warning was sent for, if any. */
  warnedForDeadline: Date | null;
  warnedAt: Date | null;
  /** A deadline charge was already made (paid, pending or declined). */
  charged: boolean;
};

export type GuaranteeStep = "nothing" | "warn" | "wait" | "charge";

export function guaranteeStep(s: GuaranteeState, now: Date): GuaranteeStep {
  if (!s.deadline || s.balanceCents <= 0 || s.charged) return "nothing";
  const warned =
    s.warnedAt !== null &&
    s.warnedForDeadline !== null &&
    s.warnedForDeadline.getTime() === s.deadline.getTime();
  if (!warned)
    return now.getTime() >= s.deadline.getTime() - WARNING_MS
      ? "warn"
      : "nothing";
  const chargeAt = Math.max(
    s.deadline.getTime(),
    (s.warnedAt?.getTime() ?? 0) + WARNING_MS,
  );
  return now.getTime() >= chargeAt ? "charge" : "wait";
}

/** When the card will be charged, for the warning email and the team page. */
export function chargeTime(deadline: Date, warnedAt: Date): Date {
  return new Date(
    Math.max(deadline.getTime(), warnedAt.getTime() + WARNING_MS),
  );
}
