import { and, eq, exists, sql } from "drizzle-orm";
import type {
  EventId,
  MerchOrderId,
  PaymentId,
  RefundId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { type RefundError, refundAmount } from "@/domain/registration/refund";
import { err, ok, type Result } from "@/domain/result";
import { eventTicket } from "../schema/event";
import { merchOrder } from "../schema/merch";
import { payment, purchase, refund } from "../schema/money";
import { recordAudit } from "./audit";
import { refreshRefundStatus } from "./payments";
import type { Db } from "./schedule";

/**
 * Refunds, full or partial (product-spec.md, "Admin refunds"). A Stripe
 * payment is refunded through Stripe in three steps: reserve the amount
 * here, ask Stripe, then record Stripe's refund id. The payment's refunded
 * total moves only when Stripe's charge.refunded webhook says so. Cash, Venmo
 * and other payments are handed back outside the app and count at once.
 */

export type RefundStartError = RefundError | "unknown_payment";

export type StartedRefund =
  | {
      kind: "stripe";
      refundId: RefundId;
      paymentIntentId: string;
      amountCents: number;
    }
  | { kind: "off_app"; refundId: RefundId; amountCents: number };

/**
 * Checks the amount against what is left on the payment, locked so two
 * admins cannot refund the same money twice, and records the refund. Call
 * it inside a transaction.
 */
export async function startRefund(
  db: Db,
  input: (
    | { seasonId: SeasonId }
    /** A payment for a ticket to this event. */
    | { eventId: EventId }
    /** The payment for this merch order. */
    | { merchOrderId: MerchOrderId }
  ) & {
    paymentId: PaymentId;
    amount: unknown;
    reason: unknown;
    actorId: UserId;
  },
): Promise<Result<StartedRefund, RefundStartError>> {
  const scope =
    "seasonId" in input
      ? eq(purchase.seasonId, input.seasonId)
      : "merchOrderId" in input
        ? exists(
            db
              .select({ id: merchOrder.id })
              .from(merchOrder)
              .where(
                and(
                  eq(merchOrder.purchaseId, purchase.id),
                  eq(merchOrder.id, input.merchOrderId),
                ),
              ),
          )
        : exists(
            db
              .select({ id: eventTicket.id })
              .from(eventTicket)
              .where(
                and(
                  eq(eventTicket.purchaseId, purchase.id),
                  eq(eventTicket.eventId, input.eventId),
                ),
              ),
          );
  const [found] = await db
    .select({
      id: payment.id,
      purchaseId: payment.purchaseId,
      method: payment.method,
      intent: payment.stripePaymentIntentId,
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
    })
    .from(payment)
    .innerJoin(purchase, eq(payment.purchaseId, purchase.id))
    .where(
      and(
        eq(payment.id, input.paymentId),
        eq(payment.status, "succeeded"),
        scope,
      ),
    )
    .for("update", { of: payment });
  if (!found) return err("unknown_payment");
  const [asked] = await db
    .select({
      cents: sql<number>`coalesce(sum(${refund.amountCents}), 0)`.mapWith(
        Number,
      ),
    })
    .from(refund)
    .where(eq(refund.paymentId, found.id));
  // Refunds asked for here may not have reached the webhook yet, and Stripe
  // may know of refunds made in its dashboard: count whichever is more.
  const already = Math.max(found.refundedCents, asked?.cents ?? 0);
  const amount = refundAmount(input.amount, found.amountCents, already);
  if (!amount.ok) return err(amount.error);
  const reason =
    typeof input.reason === "string"
      ? input.reason.trim().slice(0, 200) || null
      : null;

  const [created] = await db
    .insert(refund)
    .values({
      paymentId: found.id,
      amountCents: amount.value,
      reason,
      issuedBy: input.actorId,
    })
    .returning({ id: refund.id });
  if (!created) throw new Error("refund was not recorded");

  if (found.method === "stripe" && found.intent)
    return ok({
      kind: "stripe",
      refundId: created.id,
      paymentIntentId: found.intent,
      amountCents: amount.value,
    });

  await db
    .update(payment)
    .set({ refundedCents: found.refundedCents + amount.value })
    .where(eq(payment.id, found.id));
  await refreshRefundStatus(db, found.purchaseId);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "refund.issue",
    entityType: "payment",
    entityId: found.id,
    after: {
      refundId: created.id,
      method: found.method,
      amountCents: amount.value,
      reason,
    },
  });
  return ok({
    kind: "off_app",
    refundId: created.id,
    amountCents: amount.value,
  });
}

/** Stripe took the refund: keep its id and record who issued it. */
export async function confirmStripeRefund(
  db: Db,
  input: { refundId: RefundId; stripeRefundId: string; actorId: UserId },
): Promise<void> {
  const [done] = await db
    .update(refund)
    .set({ stripeRefundId: input.stripeRefundId })
    .where(eq(refund.id, input.refundId))
    .returning({
      paymentId: refund.paymentId,
      amountCents: refund.amountCents,
      reason: refund.reason,
    });
  if (!done) return;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "refund.issue",
    entityType: "payment",
    entityId: done.paymentId,
    after: {
      refundId: input.refundId,
      method: "stripe",
      stripeRefundId: input.stripeRefundId,
      amountCents: done.amountCents,
      reason: done.reason,
    },
  });
}

/** Stripe refused the refund: give the reserved amount back. */
export async function dropRefund(db: Db, refundId: RefundId): Promise<void> {
  await db
    .delete(refund)
    .where(and(eq(refund.id, refundId), sql`${refund.stripeRefundId} is null`));
}
