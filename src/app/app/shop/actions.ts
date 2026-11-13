"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { viewerOf } from "@/db/queries/event-audience";
import {
  merchCheckout,
  type PlaceOutcome,
  placeMerchOrder,
} from "@/db/queries/merch";
import { attachCheckoutSession, expirePurchases } from "@/db/queries/payments";
import { profileOf } from "@/db/queries/profile";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { type MerchItemId, parseId, type TeamSeasonId } from "@/domain/ids";
import { env } from "@/env";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";
import { stripeClient } from "@/services/stripe";

/**
 * Orders an item for the signed-in player (merch.order): its stock is held
 * and they go to Stripe Checkout, or straight to their orders when credit
 * or a free member price covers it. Nothing is marked paid here: the
 * webhook does that when Stripe confirms the payment.
 */
export async function orderMerchAction(
  rawItemId: string,
  form: FormData,
): Promise<void> {
  const itemId = parseId<MerchItemId>(rawItemId);
  if (!itemId) notFound();
  const page = `/app/shop/${itemId}`;
  const subject = await requirePermissionToChange("merch.order", {
    next: page,
  });
  const lg = await currentLeague(db);
  if (!lg) notFound();
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?error=payments_off`);
  const viewer = await viewerOf(
    db,
    lg.id,
    subject.userId,
    can(subject, "merch.manage", {}),
  );
  const team = form.get("team");
  const place = () =>
    txDb.transaction((tx) =>
      placeMerchOrder(tx, {
        leagueId: lg.id,
        itemId,
        userId: subject.userId,
        member: viewer.member,
        size: form.get("size"),
        quantity: form.get("quantity"),
        teamSeasonId: parseId<TeamSeasonId>(team),
        useCredit: form.get("useCredit") === "on",
        now: new Date(),
      }),
    );
  let result = await place();
  // Back for a checkout they left open: carry on with it, or, once Stripe
  // has closed it, start again.
  if (result.ok && result.value.kind === "open_checkout") {
    const resumed = await resumeCheckout(result.value.purchaseId);
    if (resumed.kind === "url") redirect(resumed.url);
    if (resumed.kind === "paying") redirect("/app/shop?order=paid");
    result = await place();
  }
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  const outcome = result.value;
  if (outcome.kind === "paid") {
    sendQueuedSoon();
    redirect("/app/shop?order=placed");
  }
  if (outcome.kind === "open_checkout") redirect(`${page}?error=checkout_open`);
  const url = await openCheckout(outcome, { page, userId: subject.userId });
  if (!url) redirect(`${page}?error=checkout_failed`);
  redirect(url);
}

/**
 * Starts Stripe Checkout for a held order. If Stripe can't start it, the
 * stock and the credit are given back at once rather than in an hour.
 */
async function openCheckout(
  outcome: Extract<PlaceOutcome, { kind: "checkout" }>,
  context: { page: string; userId: Parameters<typeof profileOf>[1] },
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
              merchOrderId: outcome.orderId,
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
            success_url: `${env.BETTER_AUTH_URL}/app/shop?order=paid`,
            cancel_url: `${env.BETTER_AUTH_URL}${context.page}?order=cancelled`,
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
 * and its stock and credit are given back.
 */
async function resumeCheckout(
  purchaseId: Extract<PlaceOutcome, { kind: "open_checkout" }>["purchaseId"],
): Promise<
  { kind: "url"; url: string } | { kind: "paying" } | { kind: "closed" }
> {
  const stripe = stripeClient();
  const found = await merchCheckout(db, purchaseId);
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
