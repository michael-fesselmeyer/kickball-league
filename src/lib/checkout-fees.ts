import type Stripe from "stripe";
import type { FeeChoice } from "@/db/queries/payments";
import {
  type FeeMethod,
  type FeeSettings,
  feesOn,
} from "@/domain/money/processing-fee";

/**
 * Stripe Checkout with the payer covering the processing fee (ADR 0082).
 * While the league's setting is off, every helper here returns what the
 * checkout had before: the same lines and no payment method limit.
 */

type Line = { name: string; cents: number };

const FEE_LINE: Record<FeeMethod, string> = {
  card: "Card processing fee",
  bank: "Bank transfer fee",
};

/** Checkout's line items: what was bought, then the fee as its own line. */
export function checkoutLines(
  lines: readonly Line[],
  fee: { cents: number; method: FeeMethod | null },
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const all = [
    ...lines,
    ...(fee.cents > 0 && fee.method
      ? [{ name: FEE_LINE[fee.method], cents: fee.cents }]
      : []),
  ];
  return all.map((l) => ({
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: l.cents,
      product_data: { name: l.name },
    },
  }));
}

/**
 * Limits Checkout to the method the fee was worked out for: cards (with
 * Apple Pay and Google Pay) or US bank accounts. Nothing when fees are off,
 * so the Stripe dashboard's own choice of methods applies as before.
 */
export function checkoutMethods(
  method: FeeMethod | null,
): Pick<Stripe.Checkout.SessionCreateParams, "allowed_payment_method_types"> {
  if (method === "bank")
    return { allowed_payment_method_types: ["us_bank_account"] };
  if (method === "card") return { allowed_payment_method_types: ["card"] };
  return {};
}

/**
 * The online method a payer picked, when fees are on. A bank transfer only
 * where the flow offers it and the league turned it on; a card otherwise.
 */
export function feeChoice(
  picked: unknown,
  settings: FeeSettings,
  options: { bank: boolean },
): FeeChoice {
  if (!feesOn(settings)) return null;
  const bank = picked === "bank" && options.bank && settings.bankTransfers;
  return { method: bank ? "bank" : "card", settings };
}
