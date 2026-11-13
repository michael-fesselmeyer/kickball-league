import Stripe from "stripe";
import type { ChargeToSend } from "@/db/queries/guarantee";
import type { StripeEventExtras, StripeEventLike } from "@/db/queries/payments";

/**
 * Stripe calls for the captain guarantee (docs/architecture.md, section 6).
 * The card is saved by Stripe Checkout in setup mode and charged off-session
 * at the deadline; the app keeps only Stripe's ids, the brand and the last
 * four digits.
 */

/**
 * The person's Stripe customer, made once. The idempotency key names the
 * person, so two requests at once still make one customer.
 */
export async function ensureCustomer(
  stripe: Stripe,
  input: { userId: string; email: string; existing: string | null },
): Promise<string> {
  if (input.existing) return input.existing;
  const customer = await stripe.customers.create(
    { email: input.email, metadata: { userId: input.userId } },
    { idempotencyKey: `customer-${input.userId}` },
  );
  return customer.id;
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

/**
 * Looks up what a Stripe event leaves out but the app needs to apply it:
 * for a Checkout session in setup mode, the card it saved. Throws when
 * Stripe cannot say, so the webhook fails and Stripe sends it again.
 */
export async function stripeEventExtras(
  stripe: Stripe,
  event: StripeEventLike,
): Promise<StripeEventExtras> {
  if (event.type !== "checkout.session.completed") return {};
  const session = (event.data as { object?: Stripe.Checkout.Session }).object;
  if (session?.mode !== "setup" || session.metadata?.kind !== "guarantee")
    return {};
  // Stripe sends the SetupIntent's id; use it whole if it came expanded.
  const sent = session.setup_intent;
  const setupId = idOf(sent);
  if (!setupId) throw new Error("Setup session without a SetupIntent");
  const setup =
    typeof sent === "object" && sent?.payment_method
      ? sent
      : await stripe.setupIntents.retrieve(setupId);
  const paymentMethodId = idOf(setup.payment_method);
  const customerId = idOf(setup.customer) ?? idOf(session.customer);
  if (!paymentMethodId || !customerId)
    throw new Error("SetupIntent without a card or customer");
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  return {
    setup: {
      customerId,
      paymentMethodId,
      brand: method.card?.brand ?? null,
      last4: method.card?.last4 ?? null,
    },
  };
}

export type ChargeResult =
  | { ok: true; intentId: string }
  | { ok: false; declined: true; intentId: string | null };

/**
 * Charges a saved card for a deadline charge, off-session. The purchase id
 * is the idempotency key, so sending the same charge again (a retried job)
 * charges once. Only the webhook marks it paid; a decline comes back here
 * at once. Other errors throw, and the next run tries again.
 */
export async function chargeSavedCard(
  stripe: Stripe,
  charge: ChargeToSend,
): Promise<ChargeResult> {
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: charge.cents,
        currency: "usd",
        customer: charge.customerId,
        payment_method: charge.paymentMethodId,
        off_session: true,
        confirm: true,
        description: "Team balance at the payment deadline",
        metadata: { purchaseId: charge.purchaseId, kind: "guarantee_charge" },
      },
      { idempotencyKey: `guarantee-charge-${charge.purchaseId}` },
    );
    return { ok: true, intentId: intent.id };
  } catch (error) {
    if (error instanceof Stripe.errors.StripeCardError)
      return {
        ok: false,
        declined: true,
        intentId: idOf(error.payment_intent ?? null),
      };
    throw error;
  }
}
