import { and, eq, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type { LeagueId } from "@/domain/ids";
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
import {
  type FeeMethod,
  type FeeSettings,
  feeFor,
  feesOn,
  readFeeSettings,
} from "@/domain/money/processing-fee";
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
import { league } from "../schema/league";
import { season } from "../schema/season";
import type { Db } from "./schedule";
import { required } from "./rows";
import { confirmCoveredTeams } from "./team-balance";
import {
  cancelRefundedTickets,
  lockTicketEvents,
  releaseTicketHolds,
  settleTickets,
} from "./event-tickets";
import {
  endRefundedMerch,
  lockMerchItems,
  releaseMerchHolds,
  settleMerch,
} from "./merch";
import { privateEvent } from "../schema/private-event";

/**
 * Purchases and the Stripe webhook (docs/architecture.md, section 6). Only
 * the webhook marks anything paid; the browser returning from Checkout never
 * does.
 */

/**
 * One thing bought: a registration's fee or share, or an event ticket or a
 * merch order, which belong to no registration or season.
 */
export type PurchaseLine = {
  kind: ItemKind | "event_ticket" | "merch" | "private_event";
  amountCents: number;
  description: string;
  registrationId: string | null;
  teamSeasonId: string | null;
};

export async function createPurchase(
  db: Db,
  input: {
    userId: UserId;
    /** The league the money is for (ADR 0048). */
    leagueId: LeagueId;
    /** Null for an event ticket or a merch order. */
    seasonId: SeasonId | null;
    items: readonly PurchaseLine[];
    promo?: { id: PromoCodeId; discountCents: number };
    creditCents?: number;
    /** The processing fee the payer covers, and its method (ADR 0082). */
    fee?: { cents: number; method: FeeMethod | "venmo" };
    /** The card fee a payer saved with a free method (ADR 0082). */
    feeSavedCents?: number;
  },
): Promise<PurchaseId> {
  const subtotal = input.items.reduce((sum, i) => sum + i.amountCents, 0);
  const discount = input.promo?.discountCents ?? 0;
  const credit = input.creditCents ?? 0;
  const fee = input.fee && input.fee.cents > 0 ? input.fee : null;
  const [created] = await db
    .insert(purchase)
    .values({
      userId: input.userId,
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      subtotalCents: subtotal,
      discountCents: discount,
      creditAppliedCents: credit,
      feeCents: fee?.cents ?? 0,
      feeMethod: fee?.method ?? null,
      feeSavedCents: input.feeSavedCents ?? 0,
      totalCents: subtotal - discount - credit + (fee?.cents ?? 0),
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
  /** What Stripe charges: the price after discount and credit, plus the fee. */
  totalCents: number;
  /** The processing fee inside the total; zero while fees are off. */
  feeCents: number;
  feeMethod: FeeMethod | null;
  /** League credit used, already taken from the person's balance. */
  creditCents: number;
  /**
   * What to charge for each item, in order, after the discount and credit.
   * The fee is not in these: it is a line of its own.
   */
  chargeCents: number[];
};

/**
 * How the payer chose to pay online, when the league's fee setting is on
 * (ADR 0082). Null while it is off: amounts and Checkout stay as before.
 */
export type FeeChoice = { method: FeeMethod; settings: FeeSettings } | null;

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
    /** The league the money is for; its credit is the only credit used. */
    leagueId: LeagueId;
    /** Null for an event ticket, which takes no promo code. */
    seasonId: SeasonId | null;
    items: readonly PurchaseLine[];
    promoCode: string | null;
    /** Use the person's league credit. On unless they unticked it. */
    useCredit?: boolean;
    /** The processing fee to cover, when fees are on; worked out after credit. */
    processingFee?: FeeChoice;
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
    const balance = await creditBalance(db, input.userId, input.leagueId);
    creditCents = creditToApply(discounted, balance);
  }
  // The fee is on what is left to charge, so credit and discounts carry
  // none, and a purchase they cover in full has none.
  const netCents = discounted - creditCents;
  const choice = input.processingFee;
  const feeMethod = choice && netCents > 0 ? choice.method : null;
  const feeCents =
    choice && feeMethod
      ? feeFor(feeMethod, netCents, choice.settings)
      : 0;
  const purchaseId = await createPurchase(db, {
    userId: input.userId,
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    items: input.items,
    ...(promo ? { promo } : {}),
    creditCents,
    ...(feeMethod && feeCents > 0
      ? { fee: { cents: feeCents, method: feeMethod } }
      : {}),
  });
  await spendCredit(db, {
    userId: input.userId,
    leagueId: input.leagueId,
    purchaseId,
    cents: creditCents,
  });
  await input.attach?.(purchaseId);
  const totalCents = netCents + feeCents;
  if (totalCents === 0) await settlePurchase(db, purchaseId, null, input.now);
  return ok({
    purchaseId,
    totalCents,
    feeCents,
    feeMethod: feeCents > 0 ? feeMethod : null,
    creditCents,
    chargeCents: spreadDiscount(
      amounts,
      (promo?.discountCents ?? 0) + creditCents,
    ),
  });
}

/** How long a checkout may take to get its Stripe session before it's given up. */
const OPENING_MS = 2 * 60_000;

/**
 * Starts a purchase for one registration (its fee, or a team's balance),
 * one at a time. A double tap on Pay before the page's script has loaded
 * sends the form twice: without this, the first could spend the player's
 * credit (or be paid in full by it) while the second, the page the browser
 * follows, asks Stripe for the whole fee.
 *
 * Under the registration's lock: a fee is refused once the registration no
 * longer waits for payment, and a checkout still getting its Stripe page
 * makes the second wait ("in_progress"). One that never got a page, because
 * Stripe failed, is closed after two minutes and its credit given back.
 */
export async function startPurchaseFor(
  db: Db,
  input: Parameters<typeof startPurchase>[1] & {
    registrationId: RegistrationId;
    /** A registration fee, which only a pending registration pays. */
    fee: boolean;
  },
): Promise<
  Result<StartedPurchase, PromoError | "already_paid" | "in_progress">
> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`registration_checkout:${input.registrationId}`}))`,
  );
  if (input.fee) {
    const [found] = await db
      .select({ status: registration.status })
      .from(registration)
      .where(eq(registration.id, input.registrationId));
    if (found?.status !== "pending_payment") return err("already_paid");
  }
  const opening = await db
    .selectDistinct({ id: purchase.id, createdAt: purchase.createdAt })
    .from(purchase)
    .innerJoin(purchaseItem, eq(purchaseItem.purchaseId, purchase.id))
    .where(
      and(
        eq(purchaseItem.registrationId, input.registrationId),
        eq(purchase.status, "open"),
        isNull(purchase.stripeCheckoutSessionId),
      ),
    );
  const cutoff = input.now.getTime() - OPENING_MS;
  if (opening.some((p) => p.createdAt.getTime() > cutoff))
    return err("in_progress");
  await expirePurchases(
    db,
    opening.map((p) => p.id),
    input.now,
  );
  return startPurchase(db, input);
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
        // A bank transfer on its way is not left open: it is paying.
        isNull(purchase.processingSince),
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
 * event spot or merch stock their checkout held.
 */
export async function expirePurchases(
  db: Db,
  ids: PurchaseId[],
  now: Date = new Date(),
): Promise<void> {
  if (ids.length === 0) return;
  await lockTicketEvents(db, ids);
  await lockMerchItems(db, ids);
  await closePurchases(db, ids);
  await releaseTicketHolds(db, ids, now);
  await releaseMerchHolds(db, ids);
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

/** The id of the PaymentIntent a Stripe object names, expanded or not. */
function intentIdOf(
  ref: string | { id: string } | null | undefined,
): string | null {
  return typeof ref === "string" ? ref : (ref?.id ?? null);
}

/**
 * Serializes everything one PaymentIntent's events do: its payment being
 * recorded and its refunds being applied. Without it, a refund event that
 * runs beside its payment's completion finds no payment yet, and the
 * completion does not see the refund's uncommitted event row, so the refund
 * is lost. Taken before any ticket, merch or purchase lock.
 */
async function lockIntent(db: Db, intent: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`stripe_intent:${intent}`}))`,
  );
}

/**
 * What `webhook_event` keeps of an event: enough to find it in Stripe's
 * dashboard and see what it was about. Stripe's objects carry the buyer's
 * name, email, address and card details, which the league neither needs
 * nor could export or delete with the rest of a person's data, so the
 * object itself is never stored.
 */
export function storedEventPayload(event: StripeEventLike): {
  id: string;
  type: string;
  object: string | null;
  objectId: string | null;
  paymentIntent?: string | null;
  amountRefunded?: number;
} {
  const data: unknown = event.data;
  const object =
    data && typeof data === "object" && "object" in data ? data.object : null;
  const field = (name: "object" | "id") => {
    if (!object || typeof object !== "object" || !(name in object)) return null;
    const value: unknown = (object as Record<string, unknown>)[name];
    return typeof value === "string" ? value : null;
  };
  const stored = {
    id: event.id,
    type: event.type,
    object: field("object"),
    objectId: field("id"),
  };
  // A refund also keeps which payment it refunds and Stripe's running total,
  // so a refund that arrives before its payment is applied when the payment
  // is recorded (applyEarlyRefund). Neither names the buyer.
  if (event.type === "charge.refunded") {
    const charge = chargeEvent.safeParse(event);
    if (charge.success)
      return {
        ...stored,
        paymentIntent: intentIdOf(charge.data.data.object.payment_intent),
        amountRefunded: charge.data.data.object.amount_refunded,
      };
  }
  return stored;
}

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
      payload: storedEventPayload(event),
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
      const intent = intentIdOf(session.payment_intent);
      if (intent) await lockIntent(db, intent);
      // An event spot this checkout holds is changed under the event's lock,
      // taken before the purchase row, in the same order as buying one.
      await lockTicketEvents(db, [found.id]);
      await lockMerchItems(db, [found.id]);
      const paid =
        (event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded") &&
        session.payment_status === "paid";
      if (paid) await markPaid(db, found.id, session, now);
      else if (event.type === "checkout.session.completed")
        // A bank transfer: Checkout is done and the money is on its way.
        // Stripe sends async_payment_succeeded or _failed in a few days.
        await markProcessing(db, found.id, now);
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
  await lockIntent(db, intent.id);
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
  await applyEarlyRefund(db, intent.id, now);
  return true;
}

/**
 * Takes Stripe's word for how much of a charge has been refunded, whether an
 * admin refunded it here or in Stripe's dashboard. Stripe sends the running
 * total, so applying an older event again never lowers it. Stripe does not
 * deliver events in order: a refund of a payment not recorded yet changes
 * nothing now, and its stored event is applied when the payment arrives.
 */
async function recordChargeRefunded(
  db: Db,
  charge: z.infer<typeof chargeEvent>["data"]["object"],
  now: Date,
): Promise<boolean> {
  const intent = intentIdOf(charge.payment_intent);
  if (!intent) return false;
  await lockIntent(db, intent);
  return applyRefundedTotal(db, intent, charge.id, charge.amount_refunded, now);
}

/**
 * Applies the highest refunded total Stripe reported for a PaymentIntent
 * before its payment was recorded. Call it after recording the payment,
 * under the intent's lock, so a refund event that ran first is seen.
 */
async function applyEarlyRefund(
  db: Db,
  intent: string,
  now: Date,
): Promise<void> {
  const amount = sql<number>`(${webhookEvent.payload}->>'amountRefunded')::integer`;
  const [early] = await db
    .select({
      amount,
      chargeId: sql<string | null>`${webhookEvent.payload}->>'objectId'`,
    })
    .from(webhookEvent)
    .where(
      and(
        eq(webhookEvent.provider, "stripe"),
        eq(webhookEvent.type, "charge.refunded"),
        sql`${webhookEvent.payload}->>'paymentIntent' = ${intent}`,
      ),
    )
    .orderBy(sql`${amount} desc`)
    .limit(1);
  if (!early?.chargeId || !(early.amount > 0)) return;
  await applyRefundedTotal(db, intent, early.chargeId, early.amount, now);
}

/** Raises a payment's refunded total to Stripe's, and settles what follows. */
async function applyRefundedTotal(
  db: Db,
  intent: string,
  chargeId: string,
  amountRefunded: number,
  now: Date,
): Promise<boolean> {
  const [paidFor] = await db
    .select({ purchaseId: payment.purchaseId })
    .from(payment)
    .where(eq(payment.stripePaymentIntentId, intent));
  if (paidFor) {
    await lockTicketEvents(db, [paidFor.purchaseId]);
    await lockMerchItems(db, [paidFor.purchaseId]);
  }
  const [changed] = await db
    .update(payment)
    .set({
      refundedCents: sql`least(${payment.amountCents}, greatest(${payment.refundedCents}, ${amountRefunded}))`,
      stripeChargeId: sql`coalesce(${payment.stripeChargeId}, ${chargeId})`,
    })
    .where(eq(payment.stripePaymentIntentId, intent))
    .returning({ purchaseId: payment.purchaseId });
  if (!changed) return false;
  await refreshRefundStatus(db, changed.purchaseId);
  // A ticket whose money all went back, here or in Stripe's dashboard, no
  // longer gets anyone in: its spot goes to the waitlist.
  await cancelRefundedTickets(db, changed.purchaseId, now);
  // A merch order refunded in full is over, and its stock is free again.
  await endRefundedMerch(db, changed.purchaseId);
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

/**
 * A bank transfer's Checkout completed but the money takes a few business
 * days (ADR 0082). The purchase stays open and is marked, so a second "Pay"
 * leaves it alone and the guarantee's deadline charge waits for it.
 */
async function markProcessing(db: Db, id: PurchaseId, now: Date) {
  await db
    .update(purchase)
    .set({ processingSince: now })
    .where(
      and(
        eq(purchase.id, id),
        eq(purchase.status, "open"),
        isNull(purchase.processingSince),
      ),
    );
}

/**
 * An open purchase for a registration whose bank transfer is on its way,
 * so the season page says so instead of offering to pay again.
 */
export async function processingPaymentFor(
  db: Db,
  registrationId: RegistrationId,
): Promise<{ id: PurchaseId; since: Date } | null> {
  const [found] = await db
    .select({ id: purchase.id, since: purchase.processingSince })
    .from(purchase)
    .innerJoin(purchaseItem, eq(purchaseItem.purchaseId, purchase.id))
    .where(
      and(
        eq(purchaseItem.registrationId, registrationId),
        eq(purchase.status, "open"),
        isNotNull(purchase.processingSince),
      ),
    )
    .limit(1);
  return found?.since ? { id: found.id, since: found.since } : null;
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
  await releaseMerchHolds(db, [id]);
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
  const intent = intentIdOf(session.payment_intent) ?? `session:${session.id}`;
  await settlePurchase(db, purchaseId, {
    method: "stripe",
    stripePaymentIntentId: intent,
    amountCents: session.amount_total ?? 0,
    paidAt: now,
  });
  await applyEarlyRefund(db, intent, now);
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
  if (items.some((i) => i.kind === "merch")) await settleMerch(db, purchaseId);
  // The organization paid for its private event: every team plays free.
  if (items.some((i) => i.kind === "private_event")) {
    const [paid] = await db
      .select({ seasonId: purchase.seasonId })
      .from(purchase)
      .where(eq(purchase.id, purchaseId));
    if (paid?.seasonId)
      await db
        .update(privateEvent)
        .set({ paidAt: now })
        .where(
          and(
            eq(privateEvent.seasonId, paid.seasonId),
            isNull(privateEvent.paidAt),
          ),
        );
  }
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

export const OFF_APP_METHODS = [
  "cash",
  "venmo",
  "zelle",
  "check",
  "other",
] as const;
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
  const [owner] = await db
    .select({ leagueId: season.leagueId, fees: league.processingFees })
    .from(season)
    .innerJoin(league, eq(league.id, season.leagueId))
    .where(eq(season.id, input.seasonId));
  if (!owner) throw new Error("No such season.");
  const priceCents = input.items.reduce((sum, i) => sum + i.amountCents, 0);
  const fees = offAppFees(input.method, priceCents, readFeeSettings(owner.fees));
  const purchaseId = await createPurchase(db, {
    userId: input.userId,
    leagueId: owner.leagueId,
    seasonId: input.seasonId,
    items: input.items,
    ...(fees.feeCents > 0
      ? { fee: { cents: fees.feeCents, method: "venmo" as const } }
      : {}),
    feeSavedCents: fees.savedCents,
  });
  const amountCents = priceCents + fees.feeCents;
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
    after: {
      purchaseId,
      method: input.method,
      amountCents,
      ...(fees.feeCents > 0 ? { feeCents: fees.feeCents } : {}),
      note,
    },
  });
  return purchaseId;
}

/**
 * What a payment made outside the app adds or saves when the league's
 * processing fees are on (ADR 0082): a Venmo business profile's fee is the
 * payer's, and cash, Zelle, check and personal Venmo save the card fee.
 * Nothing either way while the setting is off, or for "other".
 */
export function offAppFees(
  method: OffAppMethod,
  priceCents: number,
  settings: FeeSettings,
): { feeCents: number; savedCents: number } {
  if (!feesOn(settings) || method === "other" || priceCents <= 0)
    return { feeCents: 0, savedCents: 0 };
  const feeCents = feeFor(method, priceCents, settings);
  const card = feeFor("card", priceCents, settings);
  return { feeCents, savedCents: Math.max(0, card - feeCents) };
}
