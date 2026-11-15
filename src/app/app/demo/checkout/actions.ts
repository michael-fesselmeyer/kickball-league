"use server";

import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { db } from "@/db/client";
import { openDemoCheckout } from "@/db/queries/demo";
import { env } from "@/env";
import { requireSelfToChange } from "@/lib/auth/permission";
import { demoCheckoutOn, returnPath } from "@/lib/demo/checkout";
import { sendQueuedSoon } from "@/services/outbox";
import { stripeClient, stripeWebhookSecret } from "@/services/stripe";

/**
 * "Pay" on the local demo's checkout page (docs/adr/0052-local-demo-runs-offline.md).
 * stripe-mock has no page to pay on and never calls back, so this does what
 * Stripe would: it signs a `checkout.session.completed` event with the
 * demo's own webhook secret and hands it to the webhook route, which checks
 * the signature and marks the purchase paid exactly as it does for Stripe.
 * No card is involved.
 */
export async function payDemoCheckout(
  sessionId: string,
  back: string,
): Promise<void> {
  if (!demoCheckoutOn(process.env)) notFound();
  const page = `/app/demo/checkout/${encodeURIComponent(sessionId)}`;
  const subject = await requireSelfToChange("payment.pay_own", page);
  const found = await openDemoCheckout(db, subject.userId, sessionId);
  const stripe = stripeClient();
  const secret = stripeWebhookSecret();
  if (!found || !stripe || !secret) notFound();

  const payload = JSON.stringify({
    id: `evt_demo_${randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        payment_intent: `pi_demo_${sessionId}`,
        amount_total: found.totalCents,
        created: Math.floor(Date.now() / 1000),
      },
    },
  });
  const response = await stripeWebhook(
    new Request(new URL("/api/stripe/webhook", env.BETTER_AUTH_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
        }),
      },
      body: payload,
    }),
  );
  if (!response.ok)
    redirect(`${page}?back=${encodeURIComponent(back)}&error=1`);
  sendQueuedSoon();
  redirect(returnPath(back));
}
