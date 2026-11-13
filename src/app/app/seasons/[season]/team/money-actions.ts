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
  startPurchase,
} from "@/db/queries/payments";
import { profileOf } from "@/db/queries/profile";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { teamBalances } from "@/db/queries/team-balance";
import { can } from "@/domain/authz/permissions";
import { env } from "@/env";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { stripeClient } from "@/services/stripe";
import { ensureCustomer } from "@/services/stripe-guarantee";

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
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId;
  if (!mine || !teamSeasonId) notFound();
  if (!can(subject, "guarantee.manage", { teamSeasonId })) notFound();
  const balance = (await teamBalances(db, [teamSeasonId])).get(teamSeasonId);
  // Only split-pay teams in per-team seasons have a balance to guarantee.
  if (!balance) notFound();
  return { page, subject, season, mine, teamSeasonId, balance };
}

/** Sends the captain to Stripe Checkout to save a card, charging nothing. */
export async function startGuaranteeSetup(slug: string): Promise<void> {
  const { page, subject, teamSeasonId, balance } = await captainContext(slug);
  if (balance.balanceCents === 0) redirect(`${page}?guarantee=paid_up`);
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?guarantee=off`);
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
  if (!session.url) redirect(`${page}?guarantee=failed`);
  redirect(session.url);
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
  const { page, subject, season, mine, teamSeasonId, balance } =
    await captainContext(slug);
  if (balance.balanceCents === 0) redirect(`${page}?guarantee=paid_up`);
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?guarantee=off`);

  const stale = await openCheckoutsFor(db, mine.id);
  for (const s of stale)
    if (s.sessionId)
      await stripe.checkout.sessions.expire(s.sessionId).catch(() => null);
  await expirePurchases(
    db,
    stale.map((s) => s.id),
  );

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
  const started = await txDb.transaction((tx) =>
    startPurchase(tx, {
      userId,
      seasonId: season.id,
      items,
      promoCode: null,
      useCredit: form.get("useCredit") === "on",
      now,
    }),
  );
  if (!started.ok) redirect(`${page}?guarantee=failed`);
  const { purchaseId, totalCents, chargeCents } = started.value;
  if (totalCents === 0) redirect(`${page}?guarantee=covered`);
  const person = await profileOf(db, userId);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: purchaseId,
      metadata: { purchaseId },
      ...(person?.email ? { customer_email: person.email } : {}),
      line_items: items.map((i, n) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: chargeCents[n] ?? i.amountCents,
          product_data: { name: i.description },
        },
      })),
      success_url: `${env.BETTER_AUTH_URL}${page}?guarantee=balance_paid`,
      cancel_url: `${env.BETTER_AUTH_URL}${page}?guarantee=cancelled`,
    },
    { idempotencyKey: `purchase-${purchaseId}` },
  );
  await attachCheckoutSession(db, purchaseId, session.id);
  if (!session.url) redirect(`${page}?guarantee=failed`);
  redirect(session.url);
}
