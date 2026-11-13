import { and, eq, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import {
  parseId,
  type PromoCodeId,
  type PurchaseId,
  type RegistrationId,
  type SeasonId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import type { ItemKind } from "@/domain/registration/checkout";
import {
  checkPromo,
  normalizeCode,
  type PromoError,
  promoDiscount,
  spreadDiscount,
} from "@/domain/registration/promo";
import { creditToApply } from "@/domain/money/credit";
import { statusAfterRefunds } from "@/domain/registration/refund";
import { err, ok, type Result } from "@/domain/result";
import { savedPaymentMethod } from "../schema/guarantee";
import { payment, purchase, purchaseItem, webhookEvent } from "../schema/money";
import { recordAudit } from "./audit";
import {
  creditBalance,
  lockCredit,
  releaseCredit,
  spendCredit,
} from "./credit";
import { failCharge, saveGuarantee } from "./guarantee";
import { promoForCheckout } from "./promo-codes";
import { creditReferrals } from "./referrals";
import { registration, rosterMembership, teamSeason } from "../schema/team";
import type { Db } from "./schedule";
import { required } from "./rows";
import { confirmCoveredTeams } from "./team-balance";
import {
  cancelRefundedTickets,
  lockTicketEvents,
  releaseTicketHolds,
  settleTickets,
} from "./event-tickets";

/**
 * Purchases and the Stripe webhook (docs/architecture.md, section 6). Only
 * the webhook marks anything paid; the browser returning from Checkout never
 * does.
 */

/**
 * One thing bought: a registration's fee or share, or an event ticket,
 * which belongs to no registration or season.
 */
export type PurchaseLine = {
  kind: ItemKind | "event_ticket";
  amountCents: number;
  description: string;
  registrationId: string | null;
  teamSeasonId: string | null;
};

export async function createPurchase(
  db: Db,
  input: {
    userId: UserId;
    /** Null for an event ticket. */
    seasonId: SeasonId | null;
    items: readonly PurchaseLine[];
    promo?: { id: PromoCodeId; discountCents: number };
    creditCents?: number;
  },
): Promise<PurchaseId> {
  const subtotal = input.items.reduce((sum, i) => sum + i.amountCents, 0);
  const discount = input.promo?.discountCents ?? 0;
  const credit = input.creditCents ?? 0;
  const [created] = await db
    .insert(purchase)
    .values({
      userId: input.userId,
      seasonId: input.seasonId,
      subtotalCents: subtotal,
      discountCents: discount,
      creditAppliedCents: credit,
      totalCents: subtotal - discount - credit,
      promoCodeId: input.promo?.id ?? null,
    })
    .returning({ id: purchase.id });
  const id = required(created, "purchase").id;
  await db.insert(purchaseItem).values(
    input.items.map((i) => ({
      purchaseId: id,
      kind: i.kind,
      amountCents: i.amountCents,
      description: i.description,
      registrationId: parseId<RegistrationId>(i.registrationId),
      teamSeasonId: parseId<TeamSeasonId>(i.teamSeasonId),
    })),
  );
  return id;
}

export type StartedPurchase = {
  purchaseId: PurchaseId;
  totalCents: number;
  /** League credit used, already taken from the person's balance. */
  creditCents: number;
  /** What to charge for each item, in order, after the discount and credit. */
  chargeCents: number[];
};

/**
 * Creates the purchase for a checkout, with a promo code when one was
 * typed and the person's league credit unless they chose not to use it.
 * Call it inside a transaction: the code is locked while its uses are
 * counted, and the person's ledger while their credit is spent. A code or
 * credit that covers the whole price settles the purchase at once, with no
 * payment, so there is nothing to send to Stripe.
 */
export async function startPurchase(
  db: Db,
  input: {
    userId: UserId;
    /** Null for an event ticket, which takes no promo code. */
    seasonId: SeasonId | null;
    items: readonly PurchaseLine[];
    promoCode: string | null;
    /** Use the person's league credit. On unless they unticked it. */
    useCredit?: boolean;
    now: Date;
    /**
     * Links what the purchase is for (an event ticket) before a purchase
     * that costs nothing is settled.
     */
    attach?: (purchaseId: PurchaseId) => Promise<void>;
  },
): Promise<Result<StartedPurchase, PromoError>> {
  const amounts = input.items.map((i) => i.amountCents);
  const subtotal = amounts.reduce((total, a) => total + a, 0);
  let promo: { id: PromoCodeId; discountCents: number } | undefined;
  const typed = input.promoCode?.trim() ?? "";
  if (typed !== "") {
    const code = normalizeCode(typed);
    const stored =
      code && input.seasonId
        ? await promoForCheckout(db, input.seasonId, code)
        : null;
    const checked = checkPromo(stored, input.now);
    if (!checked.ok) return err(checked.error);
    promo = {
      id: checked.value.id,
      discountCents: promoDiscount(subtotal, checked.value),
    };
  }
  const discounted = subtotal - (promo?.discountCents ?? 0);
  let creditCents = 0;
  if (input.useCredit !== false && discounted > 0) {
    await lockCredit(db, input.userId);
    const balance = await creditBalance(db, input.userId);
    creditCents = creditToApply(discounted, balance);
  }
  const purchaseId = await createPurchase(db, {
    userId: input.userId,
    seasonId: input.seasonId,
    items: input.items,
    ...(promo ? { promo } : {}),
    creditCents,
  });
  await spendCredit(db, {
    userId: input.userId,
    purchaseId,
    cents: creditCents,
  });
  await input.attach?.(purchaseId);
  const totalCents = discounted - creditCents;
  if (totalCents === 0) await settlePurchase(db, purchaseId, null, input.now);
  return ok({
    purchaseId,
    totalCents,
    creditCents,
    chargeCents: spreadDiscount(
      amounts,
      (promo?.discountCents ?? 0) + creditCents,
    ),
  });
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

/**
 * Expires open purchases and gives back any credit they held. Nothing else:
 * expirePurchases also frees the event spots they held.
 */
export async function closePurchases(
  db: Db,
  ids: readonly PurchaseId[],
): Promise<void> {
  if (ids.length === 0) return;
  const expired = await db
    .update(purchase)
    .set({ status: "expired" })
    .where(and(inArray(purchase.id, [...ids]), eq(purchase.status, "open")))
    .returning({ id: purchase.id });
  await releaseCredit(
    db,
    expired.map((p) => p.id),
  );
}

/**
 * Expires open purchases, gives back any credit they held, and frees any
 * event spot their checkout held.
 */
export async function expirePurchases(
  db: Db,
  ids: PurchaseId[],
  now: Date = new Date(),
): Promise<void> {
  if (ids.length === 0) return;
  await lockTicketEvents(db, ids);
  await closePurchases(db, ids);
  await releaseTicketHolds(db, ids, now);
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
      mode: z.string().optional(),
      metadata: z.record(z.string(), z.string()).nullable().optional(),
    }),
  }),
});

/** The fields of a PaymentIntent event that this app reads. */
const intentEvent = z.object({
  data: z.object({
    object: z.object({
      id: z.string(),
      amount: z.number().int().nonnegative(),
      amount_received: z.number().int().nonnegative().optional(),
      metadata: z.record(z.string(), z.string()).nullable().optional(),
    }),
  }),
});

/**
 * What the webhook route looked up from Stripe before applying an event,
 * because the event itself does not carry it: for a Checkout session in
 * setup mode, the card it saved.
 */
export type StripeEventExtras = {
  setup?: {
    customerId: string;
    paymentMethodId: string;
    brand: string | null;
    last4: string | null;
  };
};

/** The fields of a charge.refunded event that this app reads. */
const chargeEvent = z.object({
  data: z.object({
    object: z.object({
      id: z.string(),
      payment_intent: z
        .union([z.string(), z.object({ id: z.string() })])
        .nullable()
        .optional(),
      amount_refunded: z.number().int().nonnegative(),
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
  extras: StripeEventExtras = {},
): Promise<EventOutcome> {
  const [recorded] = await db
    .insert(webhookEvent)
    .values({
      provider: "stripe",
      eventId: event.id,
      type: event.type,
      payload: event,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvent.id });
  if (!recorded) return "duplicate";

  let outcome: EventOutcome = "ignored";
  if (
    event.type === "checkout.session.completed" &&
    sessionEvent.parse(event).data.object.mode === "setup"
  ) {
    if (await recordSavedCard(db, event, now, extras)) outcome = "processed";
  } else if (SESSION_EVENTS.has(event.type)) {
    const parsed = sessionEvent.parse(event);
    const session = parsed.data.object;
    const [found] = await db
      .select({ id: purchase.id, status: purchase.status })
      .from(purchase)
      .where(eq(purchase.stripeCheckoutSessionId, session.id));
    if (found) {
      outcome = "processed";
      // An event spot this checkout holds is changed under the event's lock,
      // taken before the purchase row, in the same order as buying one.
      await lockTicketEvents(db, [found.id]);
      const paid =
        (event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded") &&
        session.payment_status === "paid";
      if (paid) await markPaid(db, found.id, session, now);
      else if (event.type === "checkout.session.async_payment_failed")
        await setStatusIfOpen(db, found.id, "failed", now);
      else if (event.type === "checkout.session.expired")
        await setStatusIfOpen(db, found.id, "expired", now);
    }
  } else if (event.type === "charge.refunded") {
    const charge = chargeEvent.parse(event).data.object;
    if (await recordChargeRefunded(db, charge, now)) outcome = "processed";
  } else if (
    event.type === "payment_intent.succeeded" ||
    event.type === "payment_intent.payment_failed"
  ) {
    const intent = intentEvent.parse(event).data.object;
    if (await recordAppCharge(db, event.type, intent, now))
      outcome = "processed";
  }
  await db
    .update(webhookEvent)
    .set({ status: "processed", processedAt: now })
    .where(eq(webhookEvent.id, recorded.id));
  return outcome;
}

/**
 * A captain saved a card in Checkout's setup mode: it becomes the team's
 * guarantee. The session's metadata says whose and for which team; the
 * route looked up the card itself. Without that lookup the event fails, so
 * Stripe sends it again.
 */
async function recordSavedCard(
  db: Db,
  event: StripeEventLike,
  now: Date,
  extras: StripeEventExtras,
): Promise<boolean> {
  const session = sessionEvent.parse(event).data.object;
  const meta = session.metadata ?? {};
  if (meta.kind !== "guarantee") return false;
  const userId = parseId<UserId>(meta.userId);
  const teamSeasonId = parseId<TeamSeasonId>(meta.teamSeasonId);
  if (!userId || !teamSeasonId) return false;
  if (!extras.setup) throw new Error("The saved card was not looked up");
  return saveGuarantee(db, {
    userId,
    teamSeasonId,
    sessionId: session.id,
    ...extras.setup,
    now,
  });
}

/**
 * A charge the app made itself (the captain guarantee's deadline charge)
 * succeeded or failed. Only purchases that hold this PaymentIntent, or that
 * the intent names and have none yet, are touched, so Checkout's own
 * PaymentIntents pass through untouched.
 */
async function recordAppCharge(
  db: Db,
  type: string,
  intent: z.infer<typeof intentEvent>["data"]["object"],
  now: Date,
): Promise<boolean> {
  const named = intent.metadata?.purchaseId;
  const [found] = await db
    .select({
      id: purchase.id,
      status: purchase.status,
      intent: purchase.stripePaymentIntentId,
    })
    .from(purchase)
    .where(eq(purchase.stripePaymentIntentId, intent.id));
  let target = found;
  const namedId = parseId<PurchaseId>(named);
  if (!target && namedId) {
    // Only a guarantee's own deadline charge may be found by name.
    const [byName] = await db
      .select({
        id: purchase.id,
        status: purchase.status,
        intent: purchase.stripePaymentIntentId,
      })
      .from(purchase)
      .innerJoin(
        savedPaymentMethod,
        eq(savedPaymentMethod.chargePurchaseId, purchase.id),
      )
      .where(eq(purchase.id, namedId));
    if (byName && byName.intent === null) target = byName;
  }
  if (!target) return false;
  if (target.intent === null)
    await db
      .update(purchase)
      .set({ stripePaymentIntentId: intent.id })
      .where(eq(purchase.id, target.id));
  if (type === "payment_intent.payment_failed")
    return failCharge(db, target.id, now);
  if (target.status !== "open") return false;
  await settlePurchase(db, target.id, {
    method: "stripe",
    stripePaymentIntentId: intent.id,
    amountCents: intent.amount_received ?? intent.amount,
    paidAt: now,
  });
  return true;
}

/**
 * Takes Stripe's word for how much of a charge has been refunded, whether an
 * admin refunded it here or in Stripe's dashboard. Stripe sends the running
 * total, so applying an older event again never lowers it.
 */
async function recordChargeRefunded(
  db: Db,
  charge: z.infer<typeof chargeEvent>["data"]["object"],
  now: Date,
): Promise<boolean> {
  const intent =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!intent) return false;
  const [paidFor] = await db
    .select({ purchaseId: payment.purchaseId })
    .from(payment)
    .where(eq(payment.stripePaymentIntentId, intent));
  if (paidFor) await lockTicketEvents(db, [paidFor.purchaseId]);
  const [changed] = await db
    .update(payment)
    .set({
      refundedCents: sql`least(${payment.amountCents}, greatest(${payment.refundedCents}, ${charge.amount_refunded}))`,
      stripeChargeId: sql`coalesce(${payment.stripeChargeId}, ${charge.id})`,
    })
    .where(eq(payment.stripePaymentIntentId, intent))
    .returning({ purchaseId: payment.purchaseId });
  if (!changed) return false;
  await refreshRefundStatus(db, changed.purchaseId);
  // A ticket whose money all went back, here or in Stripe's dashboard, no
  // longer gets anyone in: its spot goes to the waitlist.
  await cancelRefundedTickets(db, changed.purchaseId, now);
  return true;
}

/**
 * Sets a paid purchase to paid, partially refunded or refunded from what its
 * payments took and gave back.
 */
export async function refreshRefundStatus(
  db: Db,
  purchaseId: PurchaseId,
): Promise<void> {
  const [totals] = await db
    .select({
      paid: sum(payment.amountCents).mapWith(Number),
      refunded: sum(payment.refundedCents).mapWith(Number),
    })
    .from(payment)
    .where(
      and(eq(payment.purchaseId, purchaseId), eq(payment.status, "succeeded")),
    );
  await db
    .update(purchase)
    .set({
      status: statusAfterRefunds(totals?.paid ?? 0, totals?.refunded ?? 0),
    })
    .where(
      and(
        eq(purchase.id, purchaseId),
        inArray(purchase.status, ["paid", "partially_refunded", "refunded"]),
      ),
    );
}

async function setStatusIfOpen(
  db: Db,
  id: PurchaseId,
  status: "failed" | "expired",
  now: Date,
) {
  await db
    .update(purchase)
    .set({ status })
    .where(and(eq(purchase.id, id), eq(purchase.status, "open")));
  await releaseCredit(db, [id]);
  await releaseTicketHolds(db, [id], now);
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
  const intent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? `session:${session.id}`);
  await settlePurchase(db, purchaseId, {
    method: "stripe",
    stripePaymentIntentId: intent,
    amountCents: session.amount_total ?? 0,
    paidAt: now,
  });
}

type PaymentRecord =
  | {
      method: "stripe";
      stripePaymentIntentId: string;
      amountCents: number;
      paidAt: Date;
    }
  | {
      method: OffAppMethod;
      note: string | null;
      recordedBy: UserId;
      amountCents: number;
      paidAt: Date;
    };

/**
 * Marks a purchase paid, records the payment, activates the registrations it
 * paid for, and confirms a team whose whole fee was paid, or a split team
 * whose shares now cover it. Stripe payments and off-app payments settle the
 * same way. A purchase a promo code or credit made free has no payment to
 * record. Referrers of the registrations it paid for get their credit.
 */
export async function settlePurchase(
  db: Db,
  purchaseId: PurchaseId,
  record: PaymentRecord | null,
  now: Date = record?.paidAt ?? new Date(),
) {
  await db
    .update(purchase)
    .set({ status: "paid" })
    .where(eq(purchase.id, purchaseId));
  if (record)
    await db
      .insert(payment)
      .values({ purchaseId, status: "succeeded", ...record })
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
  if (items.some((i) => i.kind === "event_ticket"))
    await settleTickets(db, purchaseId);
  const towardSplit = items.flatMap((i) =>
    (i.kind === "player_share" || i.kind === "balance") && i.teamSeasonId
      ? [i.teamSeasonId]
      : [],
  );
  if (towardSplit.length > 0)
    await confirmCoveredTeams(db, [...new Set(towardSplit)]);
  await creditReferrals(db, registrations, now);
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

export const OFF_APP_METHODS = ["cash", "venmo", "other"] as const;
export type OffAppMethod = (typeof OFF_APP_METHODS)[number];

/**
 * Records money paid outside the app, such as cash at the field or Venmo to
 * the captain (product-spec.md, section 9). It settles exactly like a Stripe
 * payment, so the registration is paid up and nobody is chased twice.
 */
export async function recordOffAppPayment(
  db: Db,
  input: {
    userId: UserId;
    seasonId: SeasonId;
    registrationId: RegistrationId;
    items: readonly PurchaseLine[];
    method: OffAppMethod;
    note: string;
    actorId: UserId;
    now: Date;
  },
): Promise<PurchaseId> {
  const purchaseId = await createPurchase(db, {
    userId: input.userId,
    seasonId: input.seasonId,
    items: input.items,
  });
  const amountCents = input.items.reduce((sum, i) => sum + i.amountCents, 0);
  const note = input.note.trim().slice(0, 200) || null;
  await settlePurchase(db, purchaseId, {
    method: input.method,
    note,
    recordedBy: input.actorId,
    amountCents,
    paidAt: input.now,
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "payment.record_offline",
    entityType: "registration",
    entityId: input.registrationId,
    after: { purchaseId, method: input.method, amountCents, note },
  });
  return purchaseId;
}
