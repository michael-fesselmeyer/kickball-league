"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  confirmStripeRefund,
  dropRefund,
  startRefund,
} from "@/db/queries/refunds";
import { placeFreeAgent } from "@/db/queries/registrations-admin";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  type PaymentId,
  parseId,
  type RegistrationId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import {
  cancelCaptaincy,
  offerCaptaincy,
  setTeamRole,
} from "@/db/queries/captaincy";
import { isFreshSession } from "@/lib/auth/config";
import {
  requirePermissionToChange,
  sessionSignedInAt,
} from "@/lib/auth/permission";
import { stripeClient } from "@/services/stripe";
import { recordPaymentFor } from "@/app/app/seasons/[season]/record-payment";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/registrations`;

export async function recordPaymentAction(
  slug: string,
  registrationId: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("season.manage", {
    next: page,
  });
  const result = await recordPaymentFor(subject, slug, registrationId, form);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?notice=payment_recorded`);
}

export async function placeFreeAgentAction(
  slug: string,
  rawRegistrationId: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("free_agents.place", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const registrationId = parseId<RegistrationId>(rawRegistrationId);
  const teamSeasonId = parseId<TeamSeasonId>(form.get("teamSeasonId"));
  if (!registrationId || !teamSeasonId) redirect(`${page}?error=unknown_team`);
  const result = await txDb.transaction((tx) =>
    placeFreeAgent(tx, {
      seasonId: season.id,
      registrationId,
      teamSeasonId,
      actorId: subject.userId,
      now: new Date(),
      // Only from the warning's "Place anyway" button; audited.
      override: form.get("override") === "yes",
    }),
  );
  // The team keeps them off: show the admin the conflict before anything.
  if (!result.ok && result.error === "on_team_list")
    redirect(
      `${page}?conflict=${registrationId}&team=${teamSeasonId}#place-conflict`,
    );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?notice=placed`);
}

/**
 * Refunds all or part of a payment (refund.issue). Stripe payments go back
 * through Stripe and show as refunded once its webhook confirms; cash, Venmo
 * and other payments are marked refunded at once, with the admin's note.
 * Like other sensitive actions, it needs a sign-in from the last 15 minutes.
 */
export async function refundPaymentAction(
  slug: string,
  rawPaymentId: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("refund.issue", {
    next: page,
  });
  const signedInAt = await sessionSignedInAt();
  if (!signedInAt || !isFreshSession(signedInAt, new Date()))
    redirect(`${page}?error=stale`);
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const paymentId = parseId<PaymentId>(rawPaymentId);
  if (!paymentId) redirect(`${page}?error=unknown_payment`);
  const started = await txDb.transaction((tx) =>
    startRefund(tx, {
      seasonId: season.id,
      paymentId,
      amount: form.get("amount"),
      reason: form.get("reason"),
      actorId: subject.userId,
    }),
  );
  if (!started.ok) redirect(`${page}?error=${started.error}`);
  const refund = started.value;
  if (refund.kind === "off_app") redirect(`${page}?notice=refund_recorded`);

  const stripe = stripeClient();
  const sent = stripe
    ? await stripe.refunds
        .create(
          {
            payment_intent: refund.paymentIntentId,
            amount: refund.amountCents,
            metadata: { refundId: refund.refundId },
          },
          { idempotencyKey: `refund-${refund.refundId}` },
        )
        .catch((error: unknown) => {
          console.error("Stripe refund failed", refund.refundId, error);
          return null;
        })
    : null;
  if (!sent) {
    await dropRefund(db, refund.refundId);
    redirect(`${page}?error=${stripe ? "refund_failed" : "payments_off"}`);
  }
  await txDb.transaction((tx) =>
    confirmStripeRefund(tx, {
      refundId: refund.refundId,
      stripeRefundId: sent.id,
      actorId: subject.userId,
    }),
  );
  redirect(`${page}?notice=refund_sent`);
}

/** An admin's change to who leads a team (ADR 0042), back to its team. */
async function captaincyGuard(slug: string, rawTeamSeasonId: string) {
  const page = pageFor(slug);
  const teamSeasonId = parseId<TeamSeasonId>(rawTeamSeasonId);
  if (!teamSeasonId) notFound();
  const subject = await requirePermissionToChange("captaincy.manage", {
    teamSeasonId,
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const back = (code: string) =>
    `${page}?captaincy=${code}&team=${teamSeasonId}#captaincy-${teamSeasonId}`;
  return { subject, teamSeasonId, back };
}

export async function adminOfferCaptaincyAction(
  slug: string,
  rawTeamSeasonId: string,
  form: FormData,
): Promise<void> {
  const { subject, teamSeasonId, back } = await captaincyGuard(
    slug,
    rawTeamSeasonId,
  );
  const toUserId = parseId<UserId>(form.get("toUserId"));
  if (!toUserId) redirect(back("not_on_team"));
  const result = await txDb.transaction((tx) =>
    offerCaptaincy(tx, {
      teamSeasonId,
      toUserId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(back(result.ok ? "offered" : result.error));
}

export async function adminCancelCaptaincyAction(
  slug: string,
  rawTeamSeasonId: string,
): Promise<void> {
  const { subject, teamSeasonId, back } = await captaincyGuard(
    slug,
    rawTeamSeasonId,
  );
  const result = await txDb.transaction((tx) =>
    cancelCaptaincy(tx, {
      teamSeasonId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(back(result.ok ? "cancelled" : result.error));
}

export async function adminSetTeamRoleAction(
  slug: string,
  rawTeamSeasonId: string,
  rawUserId: string,
  role: "co_captain" | "player",
): Promise<void> {
  const { subject, teamSeasonId, back } = await captaincyGuard(
    slug,
    rawTeamSeasonId,
  );
  const userId = parseId<UserId>(rawUserId);
  if (!userId) notFound();
  const result = await txDb.transaction((tx) =>
    setTeamRole(tx, {
      teamSeasonId,
      userId,
      role,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(back(result.ok ? role : result.error));
}
