"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  checkInTicket,
  finishTicketRefund,
  startTicketRefund,
} from "@/db/queries/event-tickets";
import { eventBySlug } from "@/db/queries/events";
import { dropRefund } from "@/db/queries/refunds";
import { type EventTicketId, parseId } from "@/domain/ids";
import { isFreshSession } from "@/lib/auth/config";
import {
  requirePermissionToChange,
  sessionSignedInAt,
} from "@/lib/auth/permission";
import { refreshEventPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";
import { stripeClient } from "@/services/stripe";

const pageFor = (slug: string) => `/app/admin/events/${slug}`;

/**
 * Refunds a ticket in full (refund.issue) through the refund flow: the card
 * part goes back through Stripe, the credit part back to the buyer's
 * balance, and the spot goes to the next person on the waitlist. Like other
 * refunds, it needs a sign-in from the last 15 minutes.
 */
export async function refundTicketAction(
  slug: string,
  rawTicketId: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("refund.issue", {
    next: page,
  });
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm#tickets`);
  const signedInAt = await sessionSignedInAt();
  if (!signedInAt || !isFreshSession(signedInAt, new Date()))
    redirect(`${page}?error=stale#tickets`);
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  const ticketId = parseId<EventTicketId>(rawTicketId);
  if (!ticketId) redirect(`${page}?error=not_found#tickets`);
  const reason = form.get("reason");
  const started = await txDb.transaction((tx) =>
    startTicketRefund(tx, {
      eventId: e.id,
      ticketId,
      reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "",
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!started.ok) redirect(`${page}?error=${started.error}#tickets`);
  const refund = started.value;
  if (refund.kind === "stripe") {
    const stripe = stripeClient();
    const sent = stripe
      ? await stripe.refunds
          .create(
            {
              payment_intent: refund.paymentIntentId,
              amount: refund.amountCents,
              metadata: { refundId: refund.refundId, ticketId },
            },
            { idempotencyKey: `refund-${refund.refundId}` },
          )
          .catch((error: unknown) => {
            console.error("Stripe refund failed", refund.refundId, error);
            return null;
          })
      : null;
    if (!sent) {
      await dropRefund(db, refund.refundId);
      redirect(
        `${page}?error=${stripe ? "refund_failed" : "payments_off"}#tickets`,
      );
    }
    await txDb.transaction((tx) =>
      finishTicketRefund(tx, {
        eventId: e.id,
        ticketId,
        refundId: refund.refundId,
        stripeRefundId: sent.id,
        amountCents: refund.amountCents,
        actorId: subject.userId,
        now: new Date(),
      }),
    );
  }
  sendQueuedSoon();
  refreshEventPages(slug);
  redirect(`${page}?saved=refunded#tickets`);
}

/** Checks a ticket holder in at the door by the code on their ticket. */
export async function checkInTicketAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("event.manage", {
    next: page,
  });
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  const code = form.get("code");
  const result = await txDb.transaction((tx) =>
    checkInTicket(tx, {
      eventId: e.id,
      code: typeof code === "string" ? code : "",
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#tickets`);
  // The page names who it was from the code; no name goes in the address.
  redirect(`${page}?checkedIn=${result.value.code}#tickets`);
}
