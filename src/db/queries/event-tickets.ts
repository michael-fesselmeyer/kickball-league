import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { rsvpWindow, whenLine } from "@/domain/events/event";
import {
  checkInCode,
  checkoutExpiry,
  formatCode,
  holdsSpot,
  holdUntil,
  isTicketed,
  normalizeCode,
  offersToMake,
  offerUntil,
  placeForBuyer,
  type Spots,
  ticketPrice,
  type TicketStatus,
} from "@/domain/events/tickets";
import type {
  EventId,
  EventTicketId,
  PaymentId,
  PurchaseId,
  RefundId,
  UserId,
} from "@/domain/ids";
import { formatMoment } from "@/domain/money/credit";
import { formatCents } from "@/domain/registration/pricing";
import { err, ok, type Result } from "@/domain/result";
import type { EventTicketPayload } from "@/emails/event-ticket";
import { user } from "../schema/auth";
import { creditEntry } from "../schema/credit";
import { event, eventRsvp, eventTicket } from "../schema/event";
import { league } from "../schema/league";
import { payment, purchase } from "../schema/money";
import { profile } from "../schema/profile";
import { recordAudit } from "./audit";
import { counts, type LockedEvent, lockEvent, type RsvpError } from "./events";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { closePurchases, startPurchase } from "./payments";
import {
  confirmStripeRefund,
  type RefundStartError,
  startRefund,
} from "./refunds";
import type { Db } from "./schedule";

/**
 * Paid event tickets (docs/data-model.md, section 2.5; ADR 0027). Every
 * change to who holds a spot locks the event row first, as RSVPs do, so the
 * capacity can't be oversold. A paid ticket also gives its holder a going
 * RSVP, so every list, count and calendar feed that reads RSVPs sees them.
 */

/** Spots taken on an event right now: going, held or offered, and in line. */
export async function spotCounts(
  db: Db,
  e: { id: EventId; capacity: number | null },
  now: Date,
): Promise<Spots> {
  const [rsvps, [holds]] = await Promise.all([
    counts(db, e.id),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventTicket)
      .where(
        and(
          eq(eventTicket.eventId, e.id),
          inArray(eventTicket.status, ["offered", "held"]),
          gt(eventTicket.heldUntil, now),
        ),
      ),
  ]);
  return {
    capacity: e.capacity,
    going: rsvps.going,
    held: holds?.n ?? 0,
    waitlisted: rsvps.waitlisted,
  };
}

/** A check-in code no other ticket for the event uses. */
async function freshCode(db: Db, eventId: EventId): Promise<string> {
  const taken = await db
    .select({ code: eventTicket.code })
    .from(eventTicket)
    .where(eq(eventTicket.eventId, eventId));
  return checkInCode(randomBytes, new Set(taken.map((t) => t.code)));
}

function ticketMessage(
  e: Pick<LockedEvent, "title" | "slug" | "place" | "kind" | "timeZone"> & {
    startsAt: Date;
    endsAt: Date;
  },
  userId: UserId,
  extra: Omit<EventTicketPayload, "title" | "slug" | "when" | "place">,
  dedupeKey: string,
): OutboxMessage {
  const payload: EventTicketPayload = {
    title: e.title,
    slug: e.slug,
    when: whenLine(e, e.timeZone),
    place: e.place,
    ...extra,
  };
  return {
    userId,
    // Receipts and refunds are about money; an offer is event news.
    topic: extra.kind === "offered" ? "events" : "payment",
    template: "event_ticket",
    payload,
    dedupeKey,
  };
}

/**
 * Frees the spots of offers and checkouts whose time ran out, then offers
 * any free spots to the earliest people on the waitlist, a day each, with
 * an email. Call it with the event locked. Returns who got an offer.
 */
export async function offerOpenSpots(
  db: Db,
  e: LockedEvent,
  now: Date,
): Promise<UserId[]> {
  const lapsed = await db
    .update(eventTicket)
    .set({ status: "released", heldUntil: null })
    .where(
      and(
        eq(eventTicket.eventId, e.id),
        inArray(eventTicket.status, ["offered", "held"]),
        lte(eventTicket.heldUntil, now),
      ),
    )
    .returning({ purchaseId: eventTicket.purchaseId });
  // A checkout this old can't be paid any more: close it and give its
  // credit back.
  await closePurchases(
    db,
    lapsed.flatMap((t) => (t.purchaseId ? [t.purchaseId] : [])),
  );
  if (!isTicketed(e) || e.cancelledAt !== null || e.endsAt <= now) return [];
  const n = offersToMake(await spotCounts(db, e, now));
  if (n === 0) return [];
  const next = await db
    .select({ id: eventRsvp.id, userId: eventRsvp.userId })
    .from(eventRsvp)
    .where(and(eq(eventRsvp.eventId, e.id), eq(eventRsvp.status, "waitlisted")))
    .orderBy(asc(eventRsvp.createdAt), asc(eventRsvp.id))
    .limit(n);
  if (next.length === 0) return [];
  // The offer is their place now: it holds the spot until it runs out.
  await db.delete(eventRsvp).where(
    inArray(
      eventRsvp.id,
      next.map((r) => r.id),
    ),
  );
  const until = offerUntil(now, e.endsAt);
  const offered = [];
  for (const r of next) {
    const [created] = await db
      .insert(eventTicket)
      .values({
        eventId: e.id,
        userId: r.userId,
        status: "offered",
        code: await freshCode(db, e.id),
        heldUntil: until,
      })
      .returning({ id: eventTicket.id, userId: eventTicket.userId });
    if (created) offered.push(created);
  }
  await enqueueMessages(
    db,
    offered.map((t) =>
      ticketMessage(
        e,
        t.userId,
        { kind: "offered", expires: formatMoment(until, e.timeZone) },
        `event_offer/${t.id}`,
      ),
    ),
  );
  return offered.map((t) => t.userId);
}

/**
 * Locks the events whose spots these purchases' checkouts hold, before the
 * purchases themselves change, in the same order a buyer takes locks.
 */
export async function lockTicketEvents(
  db: Db,
  purchaseIds: readonly PurchaseId[],
): Promise<void> {
  if (purchaseIds.length === 0) return;
  const events = db
    .select({ id: eventTicket.eventId })
    .from(eventTicket)
    .where(inArray(eventTicket.purchaseId, [...purchaseIds]));
  await db
    .select({ id: event.id })
    .from(event)
    .where(inArray(event.id, events))
    .orderBy(asc(event.id))
    .for("update");
}

/**
 * A checkout ended unpaid (expired, failed, or replaced): the spot it held
 * is free again, and goes to the waitlist as an offer. Safe to call twice.
 */
export async function releaseTicketHolds(
  db: Db,
  purchaseIds: readonly PurchaseId[],
  now: Date,
): Promise<UserId[]> {
  if (purchaseIds.length === 0) return [];
  const released = await db
    .update(eventTicket)
    .set({ status: "released", heldUntil: null })
    .where(
      and(
        inArray(eventTicket.purchaseId, [...purchaseIds]),
        eq(eventTicket.status, "held"),
      ),
    )
    .returning({ eventId: eventTicket.eventId });
  const offered: UserId[] = [];
  for (const eventId of new Set(released.map((r) => r.eventId))) {
    const e = await lockEvent(db, eventId);
    if (e) offered.push(...(await offerOpenSpots(db, e, now)));
  }
  return offered;
}

/** "$15 on your card and $5 of league credit". */
function moneyLine(
  cardCents: number,
  creditCents: number,
  card: string,
  credit: string,
): string | undefined {
  const parts = [
    ...(cardCents > 0 ? [`${formatCents(cardCents)} ${card}`] : []),
    ...(creditCents > 0 ? [`${formatCents(creditCents)} ${credit}`] : []),
  ];
  return parts.length > 0 ? parts.join(" and ") : undefined;
}

/** The event a ticket is for, with what its email needs. */
async function ticketEvent(db: Db, eventId: EventId) {
  const [found] = await db
    .select({
      id: event.id,
      title: event.title,
      slug: event.slug,
      place: event.place,
      kind: event.kind,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: league.timezone,
    })
    .from(event)
    .innerJoin(league, eq(league.id, event.leagueId))
    .where(eq(event.id, eventId));
  return found ?? null;
}

/**
 * A ticket's checkout was paid (or cost nothing): the ticket is good, its
 * holder is going, and they get a receipt with their check-in code. Called
 * when the purchase settles. A checkout paid after its hold ran out is
 * still honored: the person paid.
 */
export async function settleTickets(
  db: Db,
  purchaseId: PurchaseId,
): Promise<void> {
  const paid = await db
    .update(eventTicket)
    .set({ status: "paid", heldUntil: null })
    .where(
      and(
        eq(eventTicket.purchaseId, purchaseId),
        inArray(eventTicket.status, ["held", "released"]),
      ),
    )
    .returning({
      id: eventTicket.id,
      eventId: eventTicket.eventId,
      userId: eventTicket.userId,
      code: eventTicket.code,
    });
  if (paid.length === 0) return;
  const [bought] = await db
    .select({
      totalCents: purchase.totalCents,
      creditCents: purchase.creditAppliedCents,
    })
    .from(purchase)
    .where(eq(purchase.id, purchaseId));
  const messages: OutboxMessage[] = [];
  for (const t of paid) {
    // Out of the line, if they were in it, and going.
    await db
      .insert(eventRsvp)
      .values({
        eventId: t.eventId,
        userId: t.userId,
        status: "going",
        createdAt: sql`clock_timestamp()`,
      })
      .onConflictDoUpdate({
        target: [eventRsvp.eventId, eventRsvp.userId],
        set: { status: "going" },
      });
    const e = await ticketEvent(db, t.eventId);
    if (!e) continue;
    messages.push(
      ticketMessage(
        e,
        t.userId,
        {
          kind: "receipt",
          code: formatCode(t.code),
          paid: moneyLine(
            bought?.totalCents ?? 0,
            bought?.creditCents ?? 0,
            "on your card",
            "of league credit",
          ),
        },
        `event_ticket/${t.id}`,
      ),
    );
  }
  await enqueueMessages(db, messages);
}

/**
 * Gives league credit spent on a ticket back to its buyer, once, as a
 * `released` row. Returns how much.
 */
async function returnTicketCredit(
  db: Db,
  purchaseId: PurchaseId,
): Promise<number> {
  const [spent] = await db
    .select({ userId: creditEntry.userId, cents: creditEntry.deltaCents })
    .from(creditEntry)
    .where(
      and(
        eq(creditEntry.purchaseId, purchaseId),
        eq(creditEntry.reason, "spent"),
      ),
    );
  if (!spent) return 0;
  const [given] = await db
    .insert(creditEntry)
    .values({
      userId: spent.userId,
      deltaCents: -spent.cents,
      reason: "released",
      purchaseId,
    })
    .onConflictDoNothing()
    .returning({ cents: creditEntry.deltaCents });
  return given?.cents ?? 0;
}

/**
 * Ends a paid ticket: refunded by the league, or given up with a deleted
 * account. Its holder stops going, credit spent on it goes back, and the
 * spot is offered to the waitlist. Only a paid ticket changes, so calling
 * it twice changes nothing. Call it with the event locked.
 */
async function endTicket(
  db: Db,
  e: LockedEvent,
  input: {
    ticketId: EventTicketId;
    status: "refunded" | "cancelled";
    cardCents: number;
    now: Date;
  },
): Promise<{ ended: boolean; creditCents: number; offered: UserId[] }> {
  const [ended] = await db
    .update(eventTicket)
    .set({ status: input.status })
    .where(
      and(eq(eventTicket.id, input.ticketId), eq(eventTicket.status, "paid")),
    )
    .returning({
      id: eventTicket.id,
      userId: eventTicket.userId,
      purchaseId: eventTicket.purchaseId,
    });
  if (!ended) return { ended: false, creditCents: 0, offered: [] };
  // Another paid ticket (a rare second checkout) keeps them going.
  const [other] = await db
    .select({ id: eventTicket.id })
    .from(eventTicket)
    .where(
      and(
        eq(eventTicket.eventId, e.id),
        eq(eventTicket.userId, ended.userId),
        eq(eventTicket.status, "paid"),
      ),
    );
  if (!other)
    await db
      .delete(eventRsvp)
      .where(
        and(eq(eventRsvp.eventId, e.id), eq(eventRsvp.userId, ended.userId)),
      );
  const creditCents = ended.purchaseId
    ? await returnTicketCredit(db, ended.purchaseId)
    : 0;
  if (input.status === "refunded" && e.endsAt > input.now)
    await enqueueMessages(db, [
      ticketMessage(
        e,
        ended.userId,
        {
          kind: "refunded",
          returned: moneyLine(
            input.cardCents,
            creditCents,
            "back to your card",
            "back to your league credit",
          ),
        },
        `event_refund/${ended.id}`,
      ),
    ]);
  const offered = await offerOpenSpots(db, e, input.now);
  return { ended: true, creditCents, offered };
}

/**
 * After a charge.refunded webhook: if every cent of a ticket's payment went
 * back, the ticket ends and its spot goes to the waitlist.
 */
export async function cancelRefundedTickets(
  db: Db,
  purchaseId: PurchaseId,
  now: Date,
): Promise<void> {
  const rows = await db
    .select({
      id: eventTicket.id,
      eventId: eventTicket.eventId,
      refundedCents: payment.refundedCents,
    })
    .from(eventTicket)
    .innerJoin(purchase, eq(purchase.id, eventTicket.purchaseId))
    .innerJoin(payment, eq(payment.purchaseId, purchase.id))
    .where(
      and(
        eq(eventTicket.purchaseId, purchaseId),
        eq(eventTicket.status, "paid"),
        eq(purchase.status, "refunded"),
      ),
    );
  for (const t of rows) {
    const e = await lockEvent(db, t.eventId);
    if (e)
      await endTicket(db, e, {
        ticketId: t.id,
        status: "refunded",
        cardCents: t.refundedCents,
        now,
      });
  }
}

/**
 * Someone leaves a ticketed event's line or spot: an offer they hold is
 * passed on. A paid ticket stays unless `paid` says to give it up (account
 * deletion), and so does a hold whose checkout may still be paid. Call it
 * with the event locked.
 */
export async function giveUpTickets(
  db: Db,
  input: { eventId: EventId; userId: UserId; paid: boolean },
): Promise<{ keptPaid: boolean; freed: boolean }> {
  const mine = await db
    .select({ id: eventTicket.id, status: eventTicket.status })
    .from(eventTicket)
    .where(
      and(
        eq(eventTicket.eventId, input.eventId),
        eq(eventTicket.userId, input.userId),
        inArray(eventTicket.status, ["offered", "held", "paid"]),
      ),
    );
  if (mine.length === 0) return { keptPaid: false, freed: false };
  if (!input.paid && mine.some((t) => t.status === "paid"))
    return { keptPaid: true, freed: false };
  const passing = mine.filter(
    (t) => t.status === "offered" || (input.paid && t.status === "held"),
  );
  if (passing.length > 0)
    await db
      .update(eventTicket)
      .set({ status: "released", heldUntil: null })
      .where(
        inArray(
          eventTicket.id,
          passing.map((t) => t.id),
        ),
      );
  const paid = mine.filter((t) => t.status === "paid");
  if (paid.length > 0)
    await db
      .update(eventTicket)
      .set({ status: "cancelled" })
      .where(
        inArray(
          eventTicket.id,
          paid.map((t) => t.id),
        ),
      );
  return { keptPaid: false, freed: passing.length + paid.length > 0 };
}

export type TicketError =
  | Exclude<RsvpError, "ticketed" | "has_ticket">
  | "free"
  | "has_ticket"
  | "going";

export type BuyOutcome =
  /** Off to Stripe Checkout, which is open until expiresAt. */
  | {
      kind: "checkout";
      ticketId: EventTicketId;
      purchaseId: PurchaseId;
      totalCents: number;
      creditCents: number;
      description: string;
      expiresAt: Date;
    }
  /** Credit or a free member price covered it: the ticket is issued. */
  | { kind: "paid"; ticketId: EventTicketId }
  /** They already have a checkout open for this event. */
  | { kind: "open_checkout"; purchaseId: PurchaseId }
  /** Full: they are in line. */
  | { kind: "waitlisted"; position: number };

/**
 * Buys one ticket for the signed-in person. With the event locked: offers
 * and checkouts that ran out are passed on first; then a spot offered to
 * them, or a free spot nobody is waiting for, is held for their checkout
 * and the purchase is started with their league credit (unless they
 * unticked it). A full event puts them in line instead. Run it in a
 * transaction. The caller checks the person may see the event.
 */
export async function buyTicket(
  db: Db,
  input: {
    eventId: EventId;
    userId: UserId;
    /** Registered in any season, for the member price. */
    member: boolean;
    useCredit: boolean;
    now: Date;
  },
): Promise<Result<BuyOutcome, TicketError>> {
  const e = await lockEvent(db, input.eventId);
  if (!e) return err("not_found");
  const window = rsvpWindow(e, input.now);
  if (window !== "open") return err(window);
  const price = ticketPrice(e, input.member);
  if (price === null) return err("free");
  await offerOpenSpots(db, e, input.now);

  const mine = await db
    .select({
      id: eventTicket.id,
      status: eventTicket.status,
      heldUntil: eventTicket.heldUntil,
      purchaseId: eventTicket.purchaseId,
    })
    .from(eventTicket)
    .where(
      and(
        eq(eventTicket.eventId, e.id),
        eq(eventTicket.userId, input.userId),
        inArray(eventTicket.status, ["offered", "held", "paid"]),
      ),
    );
  if (mine.some((t) => t.status === "paid")) return err("has_ticket");
  const open = mine.find((t) => t.status === "held" && t.purchaseId);
  if (open?.purchaseId)
    return ok({ kind: "open_checkout", purchaseId: open.purchaseId });
  const offer = mine.find((t) => t.status === "offered");

  const [rsvp] = await db
    .select({ status: eventRsvp.status, createdAt: eventRsvp.createdAt })
    .from(eventRsvp)
    .where(
      and(eq(eventRsvp.eventId, e.id), eq(eventRsvp.userId, input.userId)),
    );
  // Someone who RSVP'd while the event was free keeps that spot.
  if (rsvp?.status === "going") return err("going");
  if (!offer) {
    const spots = await spotCounts(db, e, input.now);
    if (rsvp?.status === "waitlisted" || placeForBuyer(spots) === "waitlist") {
      if (!rsvp)
        await db.insert(eventRsvp).values({
          eventId: e.id,
          userId: input.userId,
          status: "waitlisted",
          createdAt: sql`clock_timestamp()`,
        });
      const [ahead] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(eventRsvp)
        .where(
          and(
            eq(eventRsvp.eventId, e.id),
            eq(eventRsvp.status, "waitlisted"),
            rsvp ? sql`${eventRsvp.createdAt} < ${rsvp.createdAt}` : undefined,
          ),
        );
      return ok({
        kind: "waitlisted",
        position: rsvp ? (ahead?.n ?? 0) + 1 : (ahead?.n ?? 1),
      });
    }
  }

  const description = `Ticket: ${e.title}`;
  let ticketId: EventTicketId | null = offer?.id ?? null;
  const started = await startPurchase(db, {
    userId: input.userId,
    seasonId: null,
    items: [
      {
        kind: "event_ticket",
        amountCents: price,
        description,
        registrationId: null,
        teamSeasonId: null,
      },
    ],
    promoCode: null,
    useCredit: input.useCredit,
    now: input.now,
    attach: async (purchaseId) => {
      const hold = {
        status: "held" as const,
        purchaseId,
        priceCents: price,
        heldUntil: holdUntil(input.now),
      };
      if (ticketId) {
        await db
          .update(eventTicket)
          .set(hold)
          .where(eq(eventTicket.id, ticketId));
        return;
      }
      const [created] = await db
        .insert(eventTicket)
        .values({
          ...hold,
          eventId: e.id,
          userId: input.userId,
          code: await freshCode(db, e.id),
        })
        .returning({ id: eventTicket.id });
      ticketId = created?.id ?? null;
    },
  });
  // A ticket takes no promo code, so starting it can't fail.
  if (!started.ok) throw new Error(`Ticket checkout failed: ${started.error}`);
  if (!ticketId) throw new Error("The ticket was not held");
  if (started.value.totalCents === 0) return ok({ kind: "paid", ticketId });
  return ok({
    kind: "checkout",
    ticketId,
    purchaseId: started.value.purchaseId,
    totalCents: started.value.totalCents,
    creditCents: started.value.creditCents,
    description,
    expiresAt: checkoutExpiry(input.now),
  });
}

export type MyTicket = {
  id: EventTicketId;
  status: TicketStatus;
  code: string;
  heldUntil: Date | null;
  priceCents: number | null;
  purchaseId: PurchaseId | null;
  checkedInAt: Date | null;
};

/**
 * The ticket that matters to this person now: a paid one, else a live
 * checkout or offer, else the latest refunded one.
 */
export async function myTicket(
  db: Db,
  eventId: EventId,
  userId: UserId,
  now: Date,
): Promise<MyTicket | null> {
  const rows = await db
    .select({
      id: eventTicket.id,
      status: eventTicket.status,
      code: eventTicket.code,
      heldUntil: eventTicket.heldUntil,
      priceCents: eventTicket.priceCents,
      purchaseId: eventTicket.purchaseId,
      checkedInAt: eventTicket.checkedInAt,
    })
    .from(eventTicket)
    .where(
      and(eq(eventTicket.eventId, eventId), eq(eventTicket.userId, userId)),
    )
    .orderBy(desc(eventTicket.createdAt));
  return (
    rows.find((t) => t.status === "paid") ??
    rows.find((t) => holdsSpot(t, now)) ??
    rows.find((t) => t.status === "refunded") ??
    null
  );
}

/** Someone's paid tickets for events not yet over, soonest first. */
export async function myUpcomingTickets(db: Db, userId: UserId, now: Date) {
  return db
    .select({
      id: eventTicket.id,
      eventId: eventTicket.eventId,
      code: eventTicket.code,
      slug: event.slug,
      title: event.title,
      kind: event.kind,
      place: event.place,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: league.timezone,
    })
    .from(eventTicket)
    .innerJoin(event, eq(event.id, eventTicket.eventId))
    .innerJoin(league, eq(league.id, event.leagueId))
    .where(
      and(
        eq(eventTicket.userId, userId),
        eq(eventTicket.status, "paid"),
        gt(event.endsAt, now),
        sql`${event.deletedAt} is null`,
      ),
    )
    .orderBy(asc(event.startsAt));
}

export type TicketHolder = {
  id: EventTicketId;
  name: string;
  email: string;
  status: TicketStatus;
  code: string;
  priceCents: number | null;
  creditCents: number;
  cardCents: number;
  refundedCents: number;
  paymentId: PaymentId | null;
  checkedInAt: Date | null;
  since: Date;
};

/**
 * The admin's ticket list: every paid and refunded ticket with what was
 * paid on the card and in credit, plus how many spots are held right now
 * for checkouts and offers. Two queries, read in parallel.
 */
export async function eventTickets(
  db: Db,
  eventId: EventId,
  now: Date,
): Promise<{ holders: TicketHolder[]; checkingOut: number; offered: number }> {
  const [rows, live] = await Promise.all([
    db
      .select({
        id: eventTicket.id,
        first: profile.firstName,
        last: profile.lastName,
        account: user.name,
        email: user.email,
        status: eventTicket.status,
        code: eventTicket.code,
        priceCents: eventTicket.priceCents,
        creditCents: purchase.creditAppliedCents,
        paymentId: payment.id,
        cardCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        checkedInAt: eventTicket.checkedInAt,
        since: eventTicket.updatedAt,
      })
      .from(eventTicket)
      .innerJoin(user, eq(user.id, eventTicket.userId))
      .leftJoin(profile, eq(profile.userId, eventTicket.userId))
      .leftJoin(purchase, eq(purchase.id, eventTicket.purchaseId))
      .leftJoin(
        payment,
        and(
          eq(payment.purchaseId, purchase.id),
          eq(payment.status, "succeeded"),
        ),
      )
      .where(
        and(
          eq(eventTicket.eventId, eventId),
          inArray(eventTicket.status, ["paid", "refunded"]),
        ),
      )
      .orderBy(
        sql`${eventTicket.status} = 'refunded'`,
        asc(eventTicket.createdAt),
        asc(eventTicket.id),
      ),
    db
      .select({ status: eventTicket.status, n: sql<number>`count(*)::int` })
      .from(eventTicket)
      .where(
        and(
          eq(eventTicket.eventId, eventId),
          inArray(eventTicket.status, ["offered", "held"]),
          gt(eventTicket.heldUntil, now),
        ),
      )
      .groupBy(eventTicket.status),
  ]);
  return {
    holders: rows.map((r) => ({
      id: r.id,
      name: [r.first, r.last].filter(Boolean).join(" ") || r.account,
      email: r.email,
      status: r.status,
      code: r.code,
      priceCents: r.priceCents,
      creditCents: r.creditCents ?? 0,
      cardCents: r.cardCents ?? 0,
      refundedCents: r.refundedCents ?? 0,
      paymentId: r.paymentId,
      checkedInAt: r.checkedInAt,
      since: r.since,
    })),
    checkingOut: live.find((l) => l.status === "held")?.n ?? 0,
    offered: live.find((l) => l.status === "offered")?.n ?? 0,
  };
}

export type CheckInError = "bad_code" | "unknown_code" | "already_in";

/** Marks a paid ticket checked in at the door, by its code. */
export async function checkInTicket(
  db: Db,
  input: { eventId: EventId; code: string; actorId: UserId; now: Date },
): Promise<Result<{ name: string; code: string }, CheckInError>> {
  const code = normalizeCode(input.code);
  if (!code) return err("bad_code");
  const [found] = await db
    .select({
      id: eventTicket.id,
      checkedInAt: eventTicket.checkedInAt,
      first: profile.firstName,
      last: profile.lastName,
      account: user.name,
    })
    .from(eventTicket)
    .innerJoin(user, eq(user.id, eventTicket.userId))
    .leftJoin(profile, eq(profile.userId, eventTicket.userId))
    .where(
      and(
        eq(eventTicket.eventId, input.eventId),
        eq(eventTicket.code, code),
        eq(eventTicket.status, "paid"),
      ),
    )
    .for("update", { of: eventTicket });
  if (!found) return err("unknown_code");
  const name =
    [found.first, found.last].filter(Boolean).join(" ") || found.account;
  if (found.checkedInAt) return err("already_in");
  await db
    .update(eventTicket)
    .set({ checkedInAt: input.now })
    .where(eq(eventTicket.id, found.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "event.ticket_check_in",
    entityType: "event",
    entityId: input.eventId,
    after: { ticketId: found.id },
  });
  return ok({ name, code });
}

export type TicketRefundError =
  "not_found" | "not_paid" | Exclude<RefundStartError, "unknown_payment">;

export type StartedTicketRefund =
  /** The card part goes back through Stripe; finish once it accepts. */
  | {
      kind: "stripe";
      refundId: RefundId;
      paymentIntentId: string;
      amountCents: number;
    }
  /** Nothing was on a card (credit or a free member price): done. */
  | { kind: "done"; creditCents: number };

/**
 * An admin refunds a paid ticket in full through the refund flow: the card
 * part is reserved as a refund, and the ticket ends once Stripe accepts it
 * (finishTicketRefund). A ticket paid only with credit ends at once, with
 * the credit back. Run it in a transaction.
 */
export async function startTicketRefund(
  db: Db,
  input: {
    eventId: EventId;
    ticketId: EventTicketId;
    reason: string;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<StartedTicketRefund, TicketRefundError>> {
  const e = await lockEvent(db, input.eventId);
  if (!e) return err("not_found");
  const [t] = await db
    .select({
      status: eventTicket.status,
      paymentId: payment.id,
    })
    .from(eventTicket)
    .leftJoin(
      payment,
      and(
        eq(payment.purchaseId, eventTicket.purchaseId),
        eq(payment.status, "succeeded"),
      ),
    )
    .where(
      and(
        eq(eventTicket.id, input.ticketId),
        eq(eventTicket.eventId, input.eventId),
      ),
    );
  if (!t) return err("not_found");
  if (t.status !== "paid") return err("not_paid");
  const audit = () =>
    recordAudit(db, {
      actorId: input.actorId,
      action: "event.ticket_refund",
      entityType: "event",
      entityId: input.eventId,
      after: { ticketId: input.ticketId, reason: input.reason || null },
    });
  if (t.paymentId) {
    const started = await startRefund(db, {
      eventId: input.eventId,
      paymentId: t.paymentId,
      // Blank is everything that is left.
      amount: "",
      reason: input.reason,
      actorId: input.actorId,
    });
    if (!started.ok)
      return started.error === "unknown_payment"
        ? err("not_found")
        : err(started.error);
    if (started.value.kind === "stripe") {
      await audit();
      return ok({
        kind: "stripe",
        refundId: started.value.refundId,
        paymentIntentId: started.value.paymentIntentId,
        amountCents: started.value.amountCents,
      });
    }
  }
  const ended = await endTicket(db, e, {
    ticketId: input.ticketId,
    status: "refunded",
    cardCents: 0,
    now: input.now,
  });
  await audit();
  return ok({ kind: "done", creditCents: ended.creditCents });
}

/**
 * Stripe accepted a ticket's refund: record it as the refund flow does,
 * then end the ticket, give back its credit and offer the spot. Run it in
 * a transaction. The charge.refunded webhook may get there first; either
 * way the ticket ends once.
 */
export async function finishTicketRefund(
  db: Db,
  input: {
    eventId: EventId;
    ticketId: EventTicketId;
    refundId: RefundId;
    stripeRefundId: string;
    amountCents: number;
    actorId: UserId;
    now: Date;
  },
): Promise<void> {
  const e = await lockEvent(db, input.eventId);
  await confirmStripeRefund(db, {
    refundId: input.refundId,
    stripeRefundId: input.stripeRefundId,
    actorId: input.actorId,
  });
  if (!e) return;
  await endTicket(db, e, {
    ticketId: input.ticketId,
    status: "refunded",
    cardCents: input.amountCents,
    now: input.now,
  });
}

/** A ticket's checkout session, to send someone back to it. */
export async function ticketCheckout(db: Db, purchaseId: PurchaseId) {
  const [found] = await db
    .select({
      sessionId: purchase.stripeCheckoutSessionId,
      status: purchase.status,
    })
    .from(purchase)
    .where(eq(purchase.id, purchaseId));
  return found ?? null;
}
