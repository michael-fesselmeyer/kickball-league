import Stripe from "stripe";
import { env } from "@/env";

/**
 * The Stripe client, or null when payments are not set up yet (no keys in
 * the environment). Callers show "online payment is not set up" instead of
 * failing. Test-mode keys (sk_test_) never charge a card.
 */
export function stripeClient(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, {
    appInfo: { name: "kickball-league" },
  });
}

export function stripeWebhookSecret(): string | null {
  return env.STRIPE_WEBHOOK_SECRET ?? null;
}
