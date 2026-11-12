import Stripe from "stripe";
import { env } from "@/env";
import { stripeMockServer } from "./stripe-mock";

/**
 * The Stripe client, or null when payments are not set up yet (no keys in
 * the environment). Callers show "online payment is not set up" instead of
 * failing. Test-mode keys (sk_test_) never charge a card. The end-to-end
 * tests point a test key at Stripe's mock server (./stripe-mock.ts).
 */
export function stripeClient(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, {
    appInfo: { name: "kickball-league" },
    ...stripeMockServer(process.env),
  });
}

export function stripeWebhookSecret(): string | null {
  return env.STRIPE_WEBHOOK_SECRET ?? null;
}
