"use server";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { attachCheckoutSession, expirePurchases } from "@/db/queries/payments";
import {
  organizerPurchase,
  privateEventBySeason,
  requestPrivateEvent,
} from "@/db/queries/private-events";
import { profileOf } from "@/db/queries/profile";
import { currentLeague } from "@/db/queries/seasons";
import { parseRequest } from "@/domain/private-events/request";
import { env } from "@/env";
import { allowAction } from "@/lib/action-limit";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { logError } from "@/lib/log-error";
import { sendQueuedSoon } from "@/services/outbox";
import { stripeClient } from "@/services/stripe";

const NEW = "/app/private-events/new";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

/** Sends the signed-in organizer's request to the admins' queue. */
export async function requestPrivateEventAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("private_event.request", {
    next: NEW,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const parsed = parseRequest({
    kind: text(form, "kind"),
    organization: text(form, "organization"),
    teams: text(form, "teams"),
    preferredDates: text(form, "preferredDates"),
    note: text(form, "note"),
  });
  if (!parsed.ok) redirect(`${NEW}?error=${parsed.error}`);
  const result = await txDb.transaction((tx) =>
    requestPrivateEvent(tx, {
      leagueId: league.id,
      organizerId: subject.userId,
      request: parsed.value,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${NEW}?error=${result.error}`);
  sendQueuedSoon();
  redirect("/app/private-events?sent=1");
}

/**
 * Sends the organizer to Stripe Checkout to pay once for every team. The
 * webhook marks it paid; nothing is marked here.
 */
export async function payForPrivateEventAction(slug: string): Promise<void> {
  const page = `/app/private-events/${slug}`;
  const league = await currentLeague(db);
  if (!league) notFound();
  const event = await privateEventBySeason(db, league.id, slug);
  if (!event) notFound();
  const subject = await requirePermissionToChange("private_event.organize", {
    next: page,
    targetUserId: event.organizerId,
  });
  const stripe = stripeClient();
  if (!stripe) redirect(`${page}?error=payments_off`);
  if (!(await allowAction("checkout", subject.userId)))
    redirect(`${page}?error=too_many`);
  const started = await txDb.transaction((tx) =>
    organizerPurchase(tx, { eventId: event.id, userId: subject.userId }),
  );
  if (!started) redirect(page);
  const person = await profileOf(db, subject.userId);
  const session = await stripe.checkout.sessions
    .create(
      {
        mode: "payment",
        client_reference_id: started.purchaseId,
        metadata: { purchaseId: started.purchaseId, privateEventId: event.id },
        ...(person?.email ? { customer_email: person.email } : {}),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: started.totalCents,
              product_data: {
                name: `${event.seasonName ?? event.organization}: every team`,
              },
            },
          },
        ],
        success_url: `${env.BETTER_AUTH_URL}${page}?paid=1`,
        cancel_url: `${env.BETTER_AUTH_URL}${page}?paid=cancelled`,
      },
      { idempotencyKey: `purchase-${started.purchaseId}` },
    )
    .catch((error: unknown) => {
      logError("Stripe checkout failed", error, started.purchaseId);
      return null;
    });
  if (!session?.url) {
    await txDb.transaction((tx) => expirePurchases(tx, [started.purchaseId]));
    redirect(`${page}?error=checkout_failed`);
  }
  await attachCheckoutSession(db, started.purchaseId, session.id);
  redirect(session.url);
}
