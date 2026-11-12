import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type {
  PurchaseId,
  RegistrationId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import type { CheckoutItem } from "@/domain/registration/checkout";
import { payment, purchase, purchaseItem, webhookEvent } from "../schema/money";
import { registration, rosterMembership, teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/**
 * Purchases and the Stripe webhook (docs/architecture.md, section 6). Only
 * the webhook marks anything paid; the browser returning from Checkout never
 * does.
 */

export async function createPurchase(
  db: Db,
  input: { userId: UserId; seasonId: SeasonId; items: CheckoutItem[] },
): Promise<PurchaseId> {
  const total = input.items.reduce((sum, i) => sum + i.amountCents, 0);
  const [created] = await db
    .insert(purchase)
    .values({
      userId: input.userId,
      seasonId: input.seasonId,
      subtotalCents: total,
      totalCents: total,
    })
    .returning({ id: purchase.id });
  const id = (created as { id: PurchaseId }).id;
  await db.insert(purchaseItem).values(
    input.items.map((i) => ({
      purchaseId: id,
      kind: i.kind,
      amountCents: i.amountCents,
      description: i.description,
      registrationId: i.registrationId as RegistrationId,
      teamSeasonId: i.teamSeasonId as TeamSeasonId | null,
    })),
  );
  return id;
}

export async function attachCheckoutSession(
  db: Db,
  purchaseId: PurchaseId,
  sessionId: string,
): Promise<void> {
  await db
    .update(purchase)
    .set({ stripeCheckoutSessionId: sessionId })
    .where(eq(purchase.id, purchaseId));
}

/**
 * Open purchases for a registration that already have a Checkout session,
 * so a second "Pay" can expire them first and nobody pays twice.
 */
export async function openCheckoutsFor(db: Db, registrationId: RegistrationId) {
  return db
    .selectDistinct({
      id: purchase.id,
      sessionId: purchase.stripeCheckoutSessionId,
    })
    .from(purchase)
    .innerJoin(purchaseItem, eq(purchaseItem.purchaseId, purchase.id))
    .where(
      and(
        eq(purchaseItem.registrationId, registrationId),
        eq(purchase.status, "open"),
        isNotNull(purchase.stripeCheckoutSessionId),
      ),
    );
}

export async function expirePurchases(
  db: Db,
  ids: PurchaseId[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(purchase)
    .set({ status: "expired" })
    .where(and(inArray(purchase.id, ids), eq(purchase.status, "open")));
}

/** The fields of a Checkout Session event that this app reads. */
const sessionEvent = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.object({
      id: z.string(),
      payment_status: z.string().optional(),
      payment_intent: z
        .union([z.string(), z.object({ id: z.string() })])
        .nullable()
        .optional(),
      amount_total: z.number().nullable().optional(),
      created: z.number().optional(),
    }),
  }),
});

export type StripeEventLike = { id: string; type: string; data: unknown };

export type EventOutcome = "processed" | "duplicate" | "ignored";

const SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

/**
 * Applies a verified Stripe event once. Call it inside a transaction: the
 * event row and its effects commit together, and a duplicate delivery hits
 * the unique key and changes nothing.
 */
export async function handleStripeEvent(
  db: Db,
  event: StripeEventLike,
  now: Date,
): Promise<EventOutcome> {
  const [recorded] = await db
    .insert(webhookEvent)
    .values({
      provider: "stripe",
      eventId: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvent.id });
  if (!recorded) return "duplicate";

  let outcome: EventOutcome = "ignored";
  if (SESSION_EVENTS.has(event.type)) {
    const parsed = sessionEvent.parse(event);
    const session = parsed.data.object;
    const [found] = await db
      .select({ id: purchase.id, status: purchase.status })
      .from(purchase)
      .where(eq(purchase.stripeCheckoutSessionId, session.id));
    if (found) {
      outcome = "processed";
      const paid =
        (event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded") &&
        session.payment_status === "paid";
      if (paid) await markPaid(db, found.id, session, now);
      else if (event.type === "checkout.session.async_payment_failed")
        await setStatusIfOpen(db, found.id, "failed");
      else if (event.type === "checkout.session.expired")
        await setStatusIfOpen(db, found.id, "expired");
    }
  }
  await db
    .update(webhookEvent)
    .set({ status: "processed", processedAt: now })
    .where(eq(webhookEvent.id, recorded.id));
  return outcome;
}

async function setStatusIfOpen(
  db: Db,
  id: PurchaseId,
  status: "failed" | "expired",
) {
  await db
    .update(purchase)
    .set({ status })
    .where(and(eq(purchase.id, id), eq(purchase.status, "open")));
}

/**
 * Marks a purchase paid, records the payment, activates the registrations it
 * paid for, and confirms a team whose whole fee was paid.
 */
async function markPaid(
  db: Db,
  purchaseId: PurchaseId,
  session: z.infer<typeof sessionEvent>["data"]["object"],
  now: Date,
) {
  await db
    .update(purchase)
    .set({ status: "paid" })
    .where(eq(purchase.id, purchaseId));
  const intent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? `session:${session.id}`);
  await db
    .insert(payment)
    .values({
      purchaseId,
      stripePaymentIntentId: intent,
      amountCents: session.amount_total ?? 0,
      status: "succeeded",
      paidAt: now,
    })
    .onConflictDoNothing();
  const items = await db
    .select({
      kind: purchaseItem.kind,
      registrationId: purchaseItem.registrationId,
      teamSeasonId: purchaseItem.teamSeasonId,
    })
    .from(purchaseItem)
    .where(eq(purchaseItem.purchaseId, purchaseId));
  const registrations = items.flatMap((i) =>
    i.registrationId ? [i.registrationId] : [],
  );
  if (registrations.length > 0)
    await db
      .update(registration)
      .set({ status: "active" })
      .where(
        and(
          inArray(registration.id, registrations),
          inArray(registration.status, ["pending_payment", "pending_waiver"]),
        ),
      );
  const teamFees = items.flatMap((i) =>
    i.kind === "team_fee" && i.teamSeasonId ? [i.teamSeasonId] : [],
  );
  if (teamFees.length > 0)
    await db
      .update(teamSeason)
      .set({ status: "confirmed" })
      .where(inArray(teamSeason.id, teamFees));
  for (const teamSeasonId of teamFees)
    await settleCoveredRegistrations(db, teamSeasonId);
}

/**
 * When a captain has paid the whole team fee, every member who has signed
 * the waiver is paid up. Called when the fee is paid, and again when a
 * member signs or joins later.
 */
export async function settleCoveredRegistrations(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<void> {
  const [team] = await db
    .select({ mode: teamSeason.paymentMode, status: teamSeason.status })
    .from(teamSeason)
    .where(eq(teamSeason.id, teamSeasonId));
  if (team?.mode !== "full" || team.status !== "confirmed") return;
  const members = await db
    .select({ id: rosterMembership.registrationId })
    .from(rosterMembership)
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  if (members.length === 0) return;
  await db
    .update(registration)
    .set({ status: "active" })
    .where(
      and(
        inArray(
          registration.id,
          members.map((m) => m.id),
        ),
        eq(registration.status, "pending_payment"),
      ),
    );
}

/** The team a registration plays for, if any. */
export async function teamOfRegistration(
  db: Db,
  registrationId: RegistrationId,
): Promise<TeamSeasonId | null> {
  const [spot] = await db
    .select({ id: rosterMembership.teamSeasonId })
    .from(rosterMembership)
    .where(
      and(
        eq(rosterMembership.registrationId, registrationId),
        eq(rosterMembership.status, "active"),
      ),
    );
  return spot?.id ?? null;
}

/** A purchase's status, for the return page that waits on the webhook. */
export async function purchaseStatus(db: Db, id: PurchaseId) {
  const [found] = await db
    .select({ status: purchase.status, userId: purchase.userId })
    .from(purchase)
    .where(eq(purchase.id, id));
  return found ?? null;
}
