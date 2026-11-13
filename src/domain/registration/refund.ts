import { err, ok, type Result } from "../result";

/**
 * Refunds (product-spec.md, "Admin refunds, full or partial"). Pure: the
 * caller passes what a payment took and what has been refunded so far.
 */

export type RefundError = "bad_amount" | "too_much" | "nothing_left";

/** What can still go back on a payment. */
export function refundableCents(
  paidCents: number,
  refundedCents: number,
): number {
  return Math.max(0, paidCents - refundedCents);
}

const MONEY = /^\d{1,5}(\.\d{1,2})?$/;

/**
 * The amount an admin asked to refund, in dollars. Blank means everything
 * that is left, so a full refund is one click.
 */
export function refundAmount(
  raw: unknown,
  paidCents: number,
  refundedCents: number,
): Result<number, RefundError> {
  const left = refundableCents(paidCents, refundedCents);
  if (left === 0) return err("nothing_left");
  const value = typeof raw === "string" ? raw.trim().replace(/^\$/, "") : "";
  if (value === "") return ok(left);
  if (!MONEY.test(value)) return err("bad_amount");
  const [whole = "0", part = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (cents <= 0) return err("bad_amount");
  if (cents > left) return err("too_much");
  return ok(cents);
}

export type RefundedStatus = "paid" | "partially_refunded" | "refunded";

/** A paid purchase's status once some or all of its money has gone back. */
export function statusAfterRefunds(
  paidCents: number,
  refundedCents: number,
): RefundedStatus {
  if (refundedCents <= 0) return "paid";
  return refundedCents >= paidCents ? "refunded" : "partially_refunded";
}
