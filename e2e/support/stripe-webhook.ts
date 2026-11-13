import type { APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import Stripe from "stripe";

/**
 * Stripe's side of a payment, for the end-to-end flows. stripe-mock answers
 * the API but never calls the app back, so these build the webhook event
 * Stripe would send and sign it with the flows server's test secret
 * (playwright.config.ts). The app checks the signature exactly as it does
 * for Stripe.
 */
const WEBHOOK_SECRET = "whsec_e2e";
const stripe = new Stripe("sk_test_e2e");

/** The Checkout session of a person's newest open purchase. */
export async function openCheckoutSession(email: string): Promise<{
  sessionId: string;
  totalCents: number;
}> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      session: string | null;
      total: number;
    }>(
      `select p.stripe_checkout_session_id as session, p.total_cents as total
         from purchase p join "user" u on u.id = p.user_id
        where u.email = $1 and p.status = 'open'
        order by p.created_at desc limit 1`,
      [email],
    );
    const row = rows[0];
    if (!row?.session) throw new Error(`No open checkout for ${email}`);
    return { sessionId: row.session, totalCents: row.total };
  } finally {
    await client.end();
  }
}

let sequence = 0;

/**
 * Posts a signed `checkout.session.completed` event, as Stripe does once
 * the card is charged. Sending the same `eventId` again is a replay.
 */
export async function sendCheckoutCompleted(
  request: APIRequestContext,
  session: { sessionId: string; totalCents: number },
  eventId = `evt_e2e_${Date.now()}_${++sequence}`,
): Promise<{ status: number; outcome: string | undefined }> {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session.sessionId,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: `pi_e2e_${session.sessionId}`,
        amount_total: session.totalCents,
        created: Math.floor(Date.now() / 1000),
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  const response = await request.post("/api/stripe/webhook", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  const outcome =
    body && typeof body === "object" && "outcome" in body
      ? String(body.outcome)
      : undefined;
  return { status: response.status(), outcome };
}
