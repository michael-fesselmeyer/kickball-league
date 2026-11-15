import { stripeMockServer } from "@/services/stripe-mock";
import { demoStatus } from "./guard";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether Checkout runs on the demo's own page instead of Stripe's hosted
 * one (docs/adr/0052-local-demo-runs-offline.md). Only with demo mode fully
 * on, Stripe calls going to stripe-mock on this machine, and DEMO_CHECKOUT
 * set, which only `npm run demo` does: stripe-mock answers the API but has
 * no page to pay on.
 */
export function demoCheckoutOn(env: Env): boolean {
  return (
    env.DEMO_CHECKOUT === "true" &&
    demoStatus(env).on &&
    stripeMockServer(env) !== null
  );
}

/** "Setup" saves a card for later; "payment" pays now. */
export type CheckoutMode = "payment" | "setup";

/**
 * Where to send someone to pay: Stripe's Checkout page, or in the local demo
 * the demo's own, which comes back to `successUrl`'s page afterwards. Null
 * when Stripe gave no page.
 */
export function checkoutPage(
  session: { id: string; url: string | null },
  successUrl: string,
  mode: CheckoutMode = "payment",
  env: Env = process.env,
): string | null {
  if (!demoCheckoutOn(env)) return session.url;
  const success = new URL(successUrl);
  const query = new URLSearchParams({
    back: `${success.pathname}${success.search}`,
    ...(mode === "setup" ? { mode } : {}),
  });
  return `/app/demo/checkout/${encodeURIComponent(session.id)}?${query}`;
}

/**
 * The page to return to after the demo's checkout: only a path on this
 * site, never another address.
 */
export function returnPath(back: unknown): string {
  if (typeof back !== "string") return "/app";
  if (!back.startsWith("/") || back.startsWith("//") || back.includes("\\"))
    return "/app";
  return back;
}
