"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  attachCheckoutSession,
  createPurchase,
  expirePurchases,
  openCheckoutsFor,
} from "@/db/queries/payments";
import { profileOf } from "@/db/queries/profile";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { hasSignedSeasonWaiver } from "@/db/queries/waivers";
import { checkoutItems } from "@/domain/registration/checkout";
import { env } from "@/env";
import { requireSelf } from "@/lib/auth/permission";
import { stripeClient } from "@/services/stripe";

/**
 * Sends the person to Stripe Checkout for what they owe. Nothing is marked
 * paid here: the webhook does that when Stripe confirms the payment.
 */
export async function startCheckout(slug: string): Promise<void> {
  const page = `/app/seasons/${slug}`;
  const subject = await requireSelf("payment.pay_own", page);
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  if (!mine) notFound();
  if (!(await hasSignedSeasonWaiver(db, subject.userId, season.id)))
    redirect(`${page}/waiver`);
  const now = new Date();
  const items = checkoutItems(season, mine, now);
  if (!items.ok) redirect(`${page}?payment=${items.error}`);
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?payment=off`);

  // A second "Pay" expires the first checkout, so nobody can pay twice.
  const registrationId = mine.id;
  const stale = await openCheckoutsFor(db, registrationId);
  for (const s of stale)
    if (s.sessionId)
      await stripe.checkout.sessions.expire(s.sessionId).catch(() => null);
  await expirePurchases(
    db,
    stale.map((s) => s.id),
  );

  const purchaseId = await txDb.transaction((tx) =>
    createPurchase(tx, {
      userId: subject.userId,
      seasonId: season.id,
      items: items.items,
    }),
  );
  const person = await profileOf(db, subject.userId);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: purchaseId,
      metadata: { purchaseId },
      ...(person?.email ? { customer_email: person.email } : {}),
      line_items: items.items.map((i) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: i.amountCents,
          product_data: { name: i.description },
        },
      })),
      success_url: `${env.BETTER_AUTH_URL}${page}?paid=1`,
      cancel_url: `${env.BETTER_AUTH_URL}${page}?payment=cancelled`,
    },
    { idempotencyKey: `purchase-${purchaseId}` },
  );
  await attachCheckoutSession(db, purchaseId, session.id);
  if (!session.url) redirect(`${page}?payment=failed`);
  redirect(session.url);
}
