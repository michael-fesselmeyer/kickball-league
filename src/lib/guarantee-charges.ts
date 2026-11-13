import { txDb } from "@/db/client";
import {
  chargesToSend,
  failCharge,
  planGuarantees,
  recordChargeIntent,
} from "@/db/queries/guarantee";
import { stripeClient } from "@/services/stripe";
import { chargeSavedCard } from "@/services/stripe-guarantee";

export type GuaranteeRun = {
  warned: number;
  charged: number;
  declined: number;
  /** Charges Stripe could not take this time; the next run sends them again. */
  retry: number;
};

/**
 * The captain guarantee's daily run (docs/architecture.md, scheduled jobs):
 * sends the 72-hour warnings that are due and makes the deadline charges.
 * The database half commits first, so a charge exists before Stripe is
 * asked to take it; each Stripe call uses the purchase as its idempotency
 * key, so a retried run charges once. Only the webhook marks a charge paid.
 */
export async function runGuaranteeCharges(now: Date): Promise<GuaranteeRun> {
  const plan = await txDb.transaction((tx) => planGuarantees(tx, now));
  const run: GuaranteeRun = {
    warned: plan.warned,
    charged: 0,
    declined: 0,
    retry: 0,
  };
  const stripe = stripeClient();
  if (!stripe) return run;
  for (const charge of await chargesToSend(txDb)) {
    try {
      const result = await chargeSavedCard(stripe, charge);
      if (result.ok) {
        await recordChargeIntent(txDb, charge.purchaseId, result.intentId);
        run.charged += 1;
      } else {
        await txDb.transaction(async (tx) => {
          if (result.intentId)
            await recordChargeIntent(tx, charge.purchaseId, result.intentId);
          await failCharge(tx, charge.purchaseId, now);
        });
        run.declined += 1;
      }
    } catch (error) {
      console.error(
        "Guarantee charge failed to send",
        charge.purchaseId,
        error,
      );
      run.retry += 1;
    }
  }
  return run;
}
