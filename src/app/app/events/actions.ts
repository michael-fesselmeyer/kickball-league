"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { resetFeed, viewerOf, visibleEvent } from "@/db/queries/event-audience";
import {
  type BuyOutcome,
  buyTicket,
  ticketCheckout,
} from "@/db/queries/event-tickets";
import { joinEvent, leaveEvent } from "@/db/queries/events";
import { attachCheckoutSession, expirePurchases } from "@/db/queries/payments";
import { profileOf } from "@/db/queries/profile";
import { can } from "@/domain/authz/permissions";
import type { EventId, UserId } from "@/domain/ids";
import { env } from "@/env";
import {
  requirePermissionToChange,
  requireSelfToChange,
} from "@/lib/auth/permission";
import { refreshEventPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";
import { stripeClient } from "@/services/stripe";

async function eventFor(slug: string) {
  const page = `/app/events/${slug}`;
  const subject = await requirePermissionToChange("event.rsvp", { next: page });
  // Only an event that is for this person, so a team event's slug is no key.
  // The same check guards buying a ticket.
  const e = await visibleEvent(
    db,
    slug,
    subject.userId,
    can(subject, "event.manage", {}),
  );
  if (!e) notFound();
  return { page, subject, e, staff: can(subject, "event.manage", {}) };
}

/** RSVPs the signed-in player: a spot if there is one, else the waitlist. */
export async function joinEventAction(slug: string): Promise<void> {
  const { page, subject, e } = await eventFor(slug);
  const result = await txDb.transaction((tx) =>
    joinEvent(tx, { eventId: e.id, userId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshEventPages(e.slug);
  redirect(`${page}?done=${result.value.status}`);
}

/** Drops the signed-in player's RSVP; a freed spot goes to the waitlist. */
export async function leaveEventAction(slug: string): Promise<void> {
  const { page, subject, e } = await eventFor(slug);
  const result = await txDb.transaction((tx) =>
    leaveEvent(tx, { eventId: e.id, userId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  if (result.value.promoted.length) sendQueuedSoon();
  refreshEventPages(e.slug);
  redirect(`${page}?done=left`);
}

/** A new private calendar link; the old one stops working at once. */
export async function resetFeedAction(): Promise<void> {
  const subject = await requireSelfToChange("profile.edit", "/app/events");
  await resetFeed(db, subject.userId);
  redirect("/app/events?feed=reset#feed");
}

/**
 * Buys a ticket for the signed-in player (event.rsvp, for an event they can
 * see): their spot is held and they go to Stripe Checkout, or straight to
 * their ticket when credit or a free member price covers it, or onto the
 * waitlist when it's full. Nothing is marked paid here: the webhook does
 * that when Stripe confirms the payment.
 */
export async function buyTicketAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, e, staff } = await eventFor(slug);
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?error=payments_off`);
  const viewer = await viewerOf(db, e.leagueId, subject.userId, staff);
  const buy = () =>
    txDb.transaction((tx) =>
      buyTicket(tx, {
        eventId: e.id,
        userId: subject.userId,
        member: viewer.member,
        useCredit: form.get("useCredit") === "on",
        now: new Date(),
      }),
    );
  let result = await buy();
  // Back for a checkout they left open: carry on with it, or, once Stripe
  // has closed it, start again.
  if (result.ok && result.value.kind === "open_checkout") {
    const resumed = await resumeCheckout(result.value.purchaseId);
    if (resumed.kind === "url") redirect(resumed.url);
    if (resumed.kind === "paying") redirect(`${page}?ticket=paid`);
    result = await buy();
  }
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshEventPages(e.slug);
  const outcome = result.value;
  if (outcome.kind === "waitlisted") redirect(`${page}?done=waitlisted`);
  if (outcome.kind === "paid") {
    sendQueuedSoon();
    redirect(`${page}?ticket=paid`);
  }
  if (outcome.kind === "open_checkout") redirect(`${page}?error=checkout_open`);
  const url = await openCheckout(outcome, {
    page,
    eventId: e.id,
    userId: subject.userId,
  });
  if (!url) redirect(`${page}?error=checkout_failed`);
  redirect(url);
}

/**
 * Starts Stripe Checkout for a held ticket. If Stripe can't start it, the
 * hold and the credit are given back at once rather than waiting an hour.
 */
async function openCheckout(
  outcome: Extract<BuyOutcome, { kind: "checkout" }>,
  context: { page: string; eventId: EventId; userId: UserId },
): Promise<string | null> {
  const stripe = stripeClient();
  const person = await profileOf(db, context.userId);
  const session = stripe
    ? await stripe.checkout.sessions
        .create(
          {
            mode: "payment",
            client_reference_id: outcome.purchaseId,
            metadata: {
              purchaseId: outcome.purchaseId,
              ticketId: outcome.ticketId,
              eventId: context.eventId,
            },
            ...(person?.email ? { customer_email: person.email } : {}),
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: outcome.totalCents,
                  product_data: { name: outcome.description },
                },
              },
            ],
            expires_at: Math.floor(outcome.expiresAt.getTime() / 1000),
            success_url: `${env.BETTER_AUTH_URL}${context.page}?ticket=paid`,
            cancel_url: `${env.BETTER_AUTH_URL}${context.page}?ticket=cancelled`,
          },
          { idempotencyKey: `purchase-${outcome.purchaseId}` },
        )
        .catch((error: unknown) => {
          console.error("Stripe checkout failed", outcome.purchaseId, error);
          return null;
        })
    : null;
  if (!session?.url) {
    if (session)
      await stripe?.checkout.sessions.expire(session.id).catch(() => null);
    await txDb.transaction((tx) => expirePurchases(tx, [outcome.purchaseId]));
    return null;
  }
  await attachCheckoutSession(db, outcome.purchaseId, session.id);
  return session.url;
}

/**
 * A checkout someone left open: its page while Stripe still takes payment;
 * "paying" once it's complete and the webhook is on its way; else closed,
 * and its hold and credit are given back.
 */
async function resumeCheckout(
  purchaseId: Extract<BuyOutcome, { kind: "open_checkout" }>["purchaseId"],
): Promise<
  { kind: "url"; url: string } | { kind: "paying" } | { kind: "closed" }
> {
  const stripe = stripeClient();
  const found = await ticketCheckout(db, purchaseId);
  const session =
    stripe && found?.sessionId
      ? await stripe.checkout.sessions
          .retrieve(found.sessionId)
          .catch(() => null)
      : null;
  if (session?.status === "open" && session.url)
    return { kind: "url", url: session.url };
  if (session?.status === "complete") return { kind: "paying" };
  if (session && stripe)
    await stripe.checkout.sessions.expire(session.id).catch(() => null);
  await txDb.transaction((tx) => expirePurchases(tx, [purchaseId]));
  return { kind: "closed" };
}
