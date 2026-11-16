import type Stripe from "stripe";
import type { PurchaseId } from "@/domain/ids";

/** The two Checkout Session calls this needs, so tests can stand in. */
export type CheckoutSessions = {
  expire(id: string): Promise<unknown>;
  retrieve(
    id: string,
  ): Promise<{ status: Stripe.Checkout.Session.Status | null }>;
};

type Stale = { id: PurchaseId | string; sessionId: string | null };

/**
 * Before a second "Pay" opens a new checkout, the open ones are closed so
 * nobody pays twice. Only a checkout Stripe says is expired may be closed
 * here: one already paid in another tab, whose webhook is still on its way,
 * stays open so its payment counts ("paid"), and one Stripe can't be asked
 * about stays open too ("unknown"), so the person tries again in a moment
 * instead of risking a second charge.
 */
export async function closableCheckouts<T extends Stale>(
  sessions: CheckoutSessions,
  stale: readonly T[],
): Promise<{ close: T["id"][]; state: "clear" | "paid" | "unknown" }> {
  const close: T["id"][] = [];
  let paid = false;
  let unknown = false;
  for (const s of stale) {
    if (!s.sessionId) {
      close.push(s.id);
      continue;
    }
    // A successful expire closes it (stripe-mock answers with a fixture, so
    // its word is the call succeeding, not the status it sends back).
    const expired = await sessions.expire(s.sessionId).then(
      () => true,
      () => false,
    );
    if (expired) {
      close.push(s.id);
      continue;
    }
    const status = await sessions
      .retrieve(s.sessionId)
      .then((r) => r.status)
      .catch(() => null);
    if (status === "expired") close.push(s.id);
    else if (status === "complete") paid = true;
    else unknown = true;
  }
  return { close, state: paid ? "paid" : unknown ? "unknown" : "clear" };
}
