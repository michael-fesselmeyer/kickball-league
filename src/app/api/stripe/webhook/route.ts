import { txDb } from "@/db/client";
import { handleStripeEvent } from "@/db/queries/payments";
import { stripeClient, stripeWebhookSecret } from "@/services/stripe";
import { stripeEventExtras } from "@/services/stripe-guarantee";

/**
 * Stripe webhook (docs/architecture.md, section 6):
 * 1. verify the signature against the raw body before parsing;
 * 2. record the event once, by its id;
 * 3. apply it in the same transaction and return 200, or 500 so Stripe retries.
 * A Checkout session that saved a card is looked up first, because the
 * event does not say which card it was.
 */
export async function POST(request: Request): Promise<Response> {
  const stripe = stripeClient();
  const secret = stripeWebhookSecret();
  if (!stripe || !secret)
    return new Response("Payments are not configured", { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const body = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const extras = await stripeEventExtras(stripe, event);
    const outcome = await txDb.transaction((tx) =>
      handleStripeEvent(tx, event, new Date(), extras),
    );
    return Response.json({ received: true, outcome });
  } catch (error) {
    console.error("Stripe webhook failed", event.id, event.type, error);
    return new Response("Webhook handling failed", { status: 500 });
  }
}
