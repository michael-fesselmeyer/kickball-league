"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  removeGuarantee,
  setStripeCustomer,
  stripeCustomerOf,
} from "@/db/queries/guarantee";
import {
  attachCheckoutSession,
  expirePurchases,
  openCheckoutsFor,
  processingPaymentFor,
  startPurchaseFor,
} from "@/db/queries/payments";
import { feeSettingsOf } from "@/db/queries/processing-fees";
import { profileOf } from "@/db/queries/profile";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { teamBalances } from "@/db/queries/team-balance";
import { can } from "@/domain/authz/permissions";
import { env } from "@/env";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { checkoutLines, checkoutMethods, feeChoice } from "@/lib/checkout-fees";
import { checkoutPage } from "@/lib/demo/checkout";
import { stripeClient } from "@/services/stripe";
import { closableCheckouts } from "@/services/stale-checkouts";
import { ensureCustomer } from "@/services/stripe-guarantee";
import { allowAction } from "@/lib/action-limit";
import { activeLeague } from "@/lib/league/active";

/**
 * The captain's money tools on the team page (roadmap item 13): pay what is
 * left of a split team's fee, and save or remove the card that guarantees
 * it. Only the team's captains may use them.
 */
async function captainContext(slug: string) {
  const page = `/app/seasons/${slug}/team`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const league = await activeLeague();
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId;
  if (!mine || !teamSeasonId) notFound();
  if (!can(subject, "guarantee.manage", { teamSeasonId })) notFound();
  const balance = (await teamBalances(db, [teamSeasonId])).get(teamSeasonId);
  // Only split-pay teams in per-team seasons have a balance to guarantee.
  if (!balance) notFound();
  return { page, subject, league, season, mine, teamSeasonId, balance };
}

/** Sends the captain to Stripe Checkout to save a card, charging nothing. */
export async function startGuaranteeSetup(slug: string): Promise<void> {
  const { page, subject, teamSeasonId, balance } = await captainContext(slug);
  if (balance.balanceCents === 0) redirect(`${page}?guarantee=paid_up`);
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?guarantee=off`);
  if (!(await allowAction("checkout", subject.userId)))
    redirect(`${page}?guarantee=too_many`);
  const person = await profileOf(db, subject.userId);
  if (!person) notFound();
  const existing = await stripeCustomerOf(db, subject.userId);
  const customer = await ensureCustomer(stripe, {
    userId: subject.userId,
    email: person.email,
    existing,
  });
  if (customer !== existing)
    await setStripeCustomer(db, subject.userId, customer);
  const metadata = {
    kind: "guarantee",
    userId: subject.userId,
    teamSeasonId,
  };
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: "usd",
    customer,
    metadata,
    setup_intent_data: { metadata },
    success_url: `${env.BETTER_AUTH_URL}${page}?guarantee=saving`,
    cancel_url: `${env.BETTER_AUTH_URL}${page}?guarantee=cancelled`,
  });
  const to = checkoutPage(
    session,
    `${env.BETTER_AUTH_URL}${page}?guarantee=saving`,
    "setup",
  );
  if (!to) redirect(`${page}?guarantee=failed`);
  redirect(to);
}

/** Takes the card off; it is never charged after this. */
export async function removeGuaranteeAction(slug: string): Promise<void> {
  const { page, subject, teamSeasonId } = await captainContext(slug);
  const actorId = subject.userId;
  await txDb.transaction((tx) =>
    removeGuarantee(tx, { teamSeasonId, actorId, now: new Date() }),
  );
  redirect(`${page}?guarantee=removed`);
}

/**
 * Sends the captain to Stripe Checkout for what is left of the team's fee,
 * with their league credit unless they unticked it. The webhook confirms
 * the team once the balance is paid.
 */
export async function payBalanceAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, league, season, mine, teamSeasonId, balance } =
    await captainContext(slug);
  if (balance.balanceCents === 0) redirect(`${page}?guarantee=paid_up`);
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?guarantee=off`);
  if (!(await allowAction("checkout", subject.userId)))
    redirect(`${page}?guarantee=too_many`);

  // A bank transfer on its way is a payment: don't take a second one.
  if (await processingPaymentFor(db, mine.id))
    redirect(`${page}?guarantee=processing`);
  // Only checkouts Stripe has expired are closed: one paid in another tab
  // stays, so its payment counts and nobody is charged twice.
  const stale = await closableCheckouts(
    stripe.checkout.sessions,
    await openCheckoutsFor(db, mine.id),
  );
  if (stale.state === "paid") redirect(`${page}?guarantee=balance_paid`);
  if (stale.state === "unknown") redirect(`${page}?guarantee=failed`);
  await expirePurchases(db, stale.close);

  const items = [
    {
      kind: "balance" as const,
      amountCents: balance.balanceCents,
      description: `${season.name}: ${mine.team?.teamName ?? "team"} balance`,
      registrationId: mine.id,
      teamSeasonId,
    },
  ];
  const now = new Date();
  const userId = subject.userId;
  // Who covers the processing fee, when the league turned that on (ADR 0082).
  const fee = feeChoice(
    form.get("payMethod"),
    await feeSettingsOf(db, league.id),
    {
      bank: true,
    },
  );
  const started = await txDb.transaction((tx) =>
    startPurchaseFor(tx, {
      registrationId: mine.id,
      fee: false,
      userId,
      leagueId: league.id,
      seasonId: season.id,
      items,
      promoCode: null,
      useCredit: form.get("useCredit") === "on",
      processingFee: fee,
      now,
    }),
  );
  if (!started.ok)
    redirect(
      `${page}?guarantee=${started.error === "in_progress" ? "in_progress" : "failed"}`,
    );
  const { purchaseId, totalCents, chargeCents, feeCents, feeMethod } =
    started.value;
  if (totalCents === 0) redirect(`${page}?guarantee=covered`);
  const person = await profileOf(db, userId);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: purchaseId,
      metadata: { purchaseId },
      ...(person?.email ? { customer_email: person.email } : {}),
      line_items: checkoutLines(
        items.map((i, n) => ({
          name: i.description,
          cents: chargeCents[n] ?? i.amountCents,
        })),
        { cents: feeCents, method: feeMethod },
      ),
      ...checkoutMethods(feeMethod),
      success_url: `${env.BETTER_AUTH_URL}${page}?guarantee=balance_paid`,
      cancel_url: `${env.BETTER_AUTH_URL}${page}?guarantee=cancelled`,
    },
    { idempotencyKey: `purchase-${purchaseId}` },
  );
  await attachCheckoutSession(db, purchaseId, session.id);
  const to = checkoutPage(
    session,
    `${env.BETTER_AUTH_URL}${page}?guarantee=balance_paid`,
  );
  if (!to) redirect(`${page}?guarantee=failed`);
  redirect(to);
}
