import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PUBLIC, type Reach } from "@/domain/events/audience";
import type { EventInput } from "@/domain/events/event";
import type { TicketPrices } from "@/domain/events/tickets";
import type { EventId, LeagueId, PurchaseId, UserId } from "@/domain/ids";
import * as schema from "../schema";
import { user } from "../schema/auth";
import { creditEntry } from "../schema/credit";
import { event, eventRsvp, eventTicket } from "../schema/event";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { payment, purchase, refund, webhookEvent } from "../schema/money";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount } from "./account";
import { creditBalance } from "./credit";
import {
  buyTicket,
  checkInTicket,
  eventTickets,
  finishTicketRefund,
  myTicket,
  myUpcomingTickets,
  spotCounts,
  startTicketRefund,
} from "./event-tickets";
import {
  cancelEvent,
  createEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  myEventRsvp,
  updateEvent,
} from "./events";
import {
  attachCheckoutSession,
  expirePurchases,
  handleStripeEvent,
} from "./payments";
import type { Db } from "./schedule";

afterAll(closePool);

const NY = "America/New_York";
const NOW = new Date("2027-03-01T17:00:00Z");
const LATER = new Date("2027-03-01T19:00:00Z");

const bowling: EventInput = {
  kind: "bar_night",
  title: "Bowling night",
  place: "Strike Lanes (demo venue), 1 Example St",
  description: "Shoes included.",
  startsAt: new Date("2027-03-12T23:00:00Z"),
  endsAt: new Date("2027-03-13T02:00:00Z"),
  capacity: 2,
};

const everyone: Reach = { audience: PUBLIC, inviteUrl: null, inAppRsvp: true };
const PRICES: TicketPrices = { ticketPriceCents: 1500, memberPriceCents: 1200 };

/** An invented league with an admin and five players. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Ticket League", slug: `tickets-${tag}`, timezone: NY })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const people = await db
    .insert(user)
    .values(
      ["Admin", "Ana", "Ben", "Cy", "Di", "Eve"].map((name, i) => ({
        name: `${name} Example`,
        email: `tickets-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [admin, ana, ben, cy, di, eve] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
  ];
  const create = async (
    input: Partial<EventInput> = {},
    prices: TicketPrices = PRICES,
  ) =>
    (
      await createEvent(db, {
        leagueId: lg.id,
        timeZone: NY,
        event: { ...bowling, title: `Bowling ${tag}`, ...input },
        reach: everyone,
        prices,
        actorId: admin,
      })
    ).id;
  return { tag, leagueId: lg.id, admin, ana, ben, cy, di, eve, create };
}

const buy = (
  db: Db,
  eventId: EventId,
  userId: UserId,
  options: { member?: boolean; useCredit?: boolean; now?: Date } = {},
) =>
  buyTicket(db, {
    eventId,
    userId,
    member: options.member ?? true,
    useCredit: options.useCredit ?? true,
    now: options.now ?? NOW,
  });

/** Buys and expects a checkout, which gets a Stripe session id. */
async function checkout(
  db: Db,
  eventId: EventId,
  userId: UserId,
  options: Parameters<typeof buy>[3] = {},
) {
  const result = await buy(db, eventId, userId, options);
  if (!result.ok || result.value.kind !== "checkout")
    throw new Error(`Expected a checkout, got ${JSON.stringify(result)}`);
  const session = `cs_test_${result.value.purchaseId}`;
  await attachCheckoutSession(db, result.value.purchaseId, session);
  return { ...result.value, session };
}

async function grant(db: Db, userId: UserId, cents: number) {
  await db
    .insert(creditEntry)
    .values({ userId, deltaCents: cents, reason: "goodwill", note: "Test" });
}

let sequence = 0;
const stripeEvent = (type: string, object: Record<string, unknown>) => ({
  id: `evt_tickets_${Date.now()}_${++sequence}`,
  type,
  data: { object },
});

const completed = (session: string, totalCents: number) =>
  stripeEvent("checkout.session.completed", {
    id: session,
    payment_status: "paid",
    payment_intent: `pi_${session}`,
    amount_total: totalCents,
  });

const expired = (session: string) =>
  stripeEvent("checkout.session.expired", { id: session });

const refunded = (session: string, cents: number) =>
  stripeEvent("charge.refunded", {
    id: `ch_${session}`,
    payment_intent: `pi_${session}`,
    amount_refunded: cents,
  });

async function ticketsOf(db: Db, eventId: EventId) {
  return db
    .select({
      userId: eventTicket.userId,
      status: eventTicket.status,
      purchaseId: eventTicket.purchaseId,
    })
    .from(eventTicket)
    .where(eq(eventTicket.eventId, eventId));
}

/** Ticket emails queued for a person, as `kind`. */
async function ticketMail(db: Db, userId: UserId) {
  const rows = await db
    .select({ payload: message.payload })
    .from(message)
    .where(
      and(eq(message.userId, userId), eq(message.template, "event_ticket")),
    );
  return rows.map((r) => String(r.payload.kind));
}

async function statusOf(db: Db, id: PurchaseId) {
  const [row] = await db
    .select({ status: purchase.status })
    .from(purchase)
    .where(eq(purchase.id, id));
  return row?.status;
}

describe("ticketed and free events", () => {
  it("sells no ticket for a free event, and takes no free RSVP for a ticketed one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const free = await w.create(
        {},
        { ticketPriceCents: null, memberPriceCents: null },
      );
      expect(await buy(db, free, w.ana)).toEqual({ ok: false, error: "free" });
      const paid = await w.create();
      expect(
        await joinEvent(db, { eventId: paid, userId: w.ana, now: NOW }),
      ).toEqual({ ok: false, error: "ticketed" });
    });
  });

  it("refuses a price the database would never take", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await expect(
        w.create({}, { ticketPriceCents: 20, memberPriceCents: null }),
      ).rejects.toThrow();
    });
  });
});

describe("buyTicket", () => {
  it("holds the spot and starts a checkout for the member price less credit", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const bought = await buy(db, id, w.ana);
      if (!bought.ok || bought.value.kind !== "checkout")
        throw new Error("no checkout");
      expect(bought.value).toMatchObject({
        totalCents: 700,
        creditCents: 500,
        description: `Ticket: Bowling ${w.tag}`,
      });
      expect(await creditBalance(db, w.ana)).toBe(0);
      expect(await statusOf(db, bought.value.purchaseId)).toBe("open");
      const mine = await myTicket(db, id, w.ana, NOW);
      expect(mine).toMatchObject({ status: "held", priceCents: 1200 });
      expect(mine?.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(await spotCounts(db, { id, capacity: 2 }, NOW)).toEqual({
        capacity: 2,
        going: 0,
        held: 1,
        waitlisted: 0,
      });
      // A second click while checkout is open goes back to the same one.
      expect(await buy(db, id, w.ana)).toEqual({
        ok: true,
        value: { kind: "open_checkout", purchaseId: bought.value.purchaseId },
      });
    });
  });

  it("charges people who aren't members the full price, and skips credit when asked", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ben, 500);
      const bought = await buy(db, id, w.ben, {
        member: false,
        useCredit: false,
      });
      expect(bought.ok && bought.value).toMatchObject({
        kind: "checkout",
        totalCents: 1500,
        creditCents: 0,
      });
      expect(await creditBalance(db, w.ben)).toBe(500);
    });
  });

  it("issues the ticket at once when credit covers it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 2000);
      const bought = await buy(db, id, w.ana);
      expect(bought.ok && bought.value.kind).toBe("paid");
      expect(await creditBalance(db, w.ana)).toBe(800);
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "paid",
      });
      expect(await myEventRsvp(db, id, w.ana)).toEqual({
        status: "going",
        position: null,
      });
      expect(await ticketMail(db, w.ana)).toEqual(["receipt"]);
      // No card was charged, so no payment is recorded.
      const [row] = await ticketsOf(db, id);
      if (!row?.purchaseId) throw new Error("no purchase");
      const payments = await db
        .select()
        .from(payment)
        .where(eq(payment.purchaseId, row.purchaseId));
      expect(payments).toEqual([]);
      expect(await buy(db, id, w.ana)).toEqual({
        ok: false,
        error: "has_ticket",
      });
      const upcoming = await myUpcomingTickets(db, w.ana, NOW);
      expect(upcoming.map((t) => t.eventId)).toEqual([id]);
    });
  });

  it("gives members a free ticket when the member price is $0", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create(
        {},
        { ticketPriceCents: 1000, memberPriceCents: 0 },
      );
      expect((await buy(db, id, w.ana)).ok && "paid").toBe("paid");
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "paid",
        priceCents: 0,
      });
      const other = await buy(db, id, w.ben, { member: false });
      expect(other.ok && other.value).toMatchObject({
        kind: "checkout",
        totalCents: 1000,
      });
    });
  });

  it("puts buyers in line once held and paid spots fill the capacity", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await checkout(db, id, w.ana);
      await checkout(db, id, w.ben);
      expect(await buy(db, id, w.cy)).toEqual({
        ok: true,
        value: { kind: "waitlisted", position: 1 },
      });
      expect(await buy(db, id, w.di)).toEqual({
        ok: true,
        value: { kind: "waitlisted", position: 2 },
      });
      // Asking again keeps their place.
      expect(await buy(db, id, w.cy)).toEqual({
        ok: true,
        value: { kind: "waitlisted", position: 1 },
      });
    });
  });

  it("keeps a free RSVP made before the event had a price", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create(
        {},
        { ticketPriceCents: null, memberPriceCents: null },
      );
      await joinEvent(db, { eventId: id, userId: w.ana, now: NOW });
      const updated = await updateEvent(db, {
        id,
        event: { ...bowling, title: `Bowling ${w.tag}` },
        reach: everyone,
        prices: PRICES,
        actorId: w.admin,
        now: NOW,
      });
      expect(updated.ok).toBe(true);
      expect(await buy(db, id, w.ana)).toEqual({ ok: false, error: "going" });
      // One spot is left for a buyer.
      expect((await buy(db, id, w.ben)).ok).toBe(true);
      expect((await buy(db, id, w.cy)).ok && "in line").toBe("in line");
    });
  });
});

describe("the Stripe webhook for tickets", () => {
  it("issues the ticket once, however often the event is replayed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const c = await checkout(db, id, w.ana);
      const paid = completed(c.session, c.totalCents);
      expect(await handleStripeEvent(db, paid, NOW)).toBe("processed");
      expect(await handleStripeEvent(db, paid, NOW)).toBe("duplicate");
      expect(await statusOf(db, c.purchaseId)).toBe("paid");
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "paid",
      });
      expect(await myEventRsvp(db, id, w.ana)).toMatchObject({
        status: "going",
      });
      const payments = await db
        .select({ amount: payment.amountCents })
        .from(payment)
        .where(eq(payment.purchaseId, c.purchaseId));
      expect(payments).toEqual([{ amount: 700 }]);
      expect(await ticketMail(db, w.ana)).toEqual(["receipt"]);
      const [receipt] = await db
        .select({ payload: message.payload })
        .from(message)
        .where(eq(message.userId, w.ana));
      expect(receipt?.payload).toMatchObject({
        paid: "$7 on your card and $5 of league credit",
      });
      const recorded = await db
        .select({ id: webhookEvent.id })
        .from(webhookEvent)
        .where(eq(webhookEvent.eventId, paid.id));
      expect(recorded).toHaveLength(1);
    });
  });

  it("frees an expired checkout's spot and credit, and offers it to the next in line", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create({ capacity: 1 });
      await grant(db, w.ana, 500);
      const c = await checkout(db, id, w.ana);
      await buy(db, id, w.ben);
      const gone = expired(c.session);
      expect(await handleStripeEvent(db, gone, NOW)).toBe("processed");
      expect(await handleStripeEvent(db, gone, NOW)).toBe("duplicate");
      expect(await statusOf(db, c.purchaseId)).toBe("expired");
      expect(await creditBalance(db, w.ana)).toBe(500);
      expect(await myTicket(db, id, w.ana, NOW)).toBeNull();
      const offer = await myTicket(db, id, w.ben, NOW);
      expect(offer).toMatchObject({ status: "offered" });
      expect(offer?.heldUntil).toEqual(new Date("2027-03-02T17:00:00Z"));
      expect(await ticketMail(db, w.ben)).toEqual(["offered"]);
      // The spot is Ben's: a newcomer waits.
      expect(await buy(db, id, w.cy)).toEqual({
        ok: true,
        value: { kind: "waitlisted", position: 1 },
      });
      // Ben takes it: the offer becomes his checkout.
      const taken = await checkout(db, id, w.ben);
      expect(taken.ticketId).toBe(offer?.id);
    });
  });

  it("passes a lapsed checkout's spot on even when no webhook came", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create({ capacity: 1 });
      await grant(db, w.ana, 500);
      const c = await checkout(db, id, w.ana);
      await buy(db, id, w.ben);
      // Two hours later the hold has run out; the next buyer's lock frees it.
      expect(await buy(db, id, w.cy, { now: LATER })).toEqual({
        ok: true,
        value: { kind: "waitlisted", position: 1 },
      });
      expect(await statusOf(db, c.purchaseId)).toBe("expired");
      expect(await creditBalance(db, w.ana)).toBe(500);
      expect(await myTicket(db, id, w.ben, LATER)).toMatchObject({
        status: "offered",
      });
    });
  });

  it("frees the spot when a buyer starts over after their checkout closed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create({ capacity: 1 });
      const c = await checkout(db, id, w.ana);
      await expirePurchases(db, [c.purchaseId], NOW);
      const again = await checkout(db, id, w.ana);
      expect(again.purchaseId).not.toBe(c.purchaseId);
      expect(await spotCounts(db, { id, capacity: 1 }, NOW)).toMatchObject({
        held: 1,
      });
    });
  });
});

describe("refunds", () => {
  async function paidTicket(db: Db, w: Awaited<ReturnType<typeof world>>) {
    const id = await w.create({ capacity: 1 });
    await grant(db, w.ana, 500);
    const c = await checkout(db, id, w.ana);
    await handleStripeEvent(db, completed(c.session, c.totalCents), NOW);
    await buy(db, id, w.ben);
    const ticket = await myTicket(db, id, w.ana, NOW);
    if (!ticket) throw new Error("no ticket");
    return { id, c, ticket };
  }

  it("refunds the card through the refund flow, gives the credit back and offers the spot", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id, c, ticket } = await paidTicket(db, w);
      const started = await startTicketRefund(db, {
        eventId: id,
        ticketId: ticket.id,
        reason: "Can't make it",
        actorId: w.admin,
        now: NOW,
      });
      if (!started.ok || started.value.kind !== "stripe")
        throw new Error("no Stripe refund");
      expect(started.value).toMatchObject({
        paymentIntentId: `pi_${c.session}`,
        amountCents: 700,
      });
      // Until Stripe accepts it the ticket still stands.
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "paid",
      });
      const { refundId } = started.value;
      const finish = () =>
        finishTicketRefund(db, {
          eventId: id,
          ticketId: ticket.id,
          refundId,
          stripeRefundId: "re_test_1",
          amountCents: 700,
          actorId: w.admin,
          now: NOW,
        });
      await finish();
      await finish();
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "refunded",
      });
      expect(await myEventRsvp(db, id, w.ana)).toBeNull();
      expect(await creditBalance(db, w.ana)).toBe(500);
      expect(await ticketMail(db, w.ana)).toEqual(["receipt", "refunded"]);
      expect(await myTicket(db, id, w.ben, NOW)).toMatchObject({
        status: "offered",
      });
      const [row] = await db
        .select({ stripe: refund.stripeRefundId, amount: refund.amountCents })
        .from(refund)
        .where(eq(refund.stripeRefundId, "re_test_1"));
      expect(row).toEqual({ stripe: "re_test_1", amount: 700 });

      // Stripe's charge.refunded follows and only settles the money.
      expect(await handleStripeEvent(db, refunded(c.session, 700), NOW)).toBe(
        "processed",
      );
      expect(await statusOf(db, c.purchaseId)).toBe("refunded");
      expect(await ticketMail(db, w.ana)).toEqual(["receipt", "refunded"]);
      expect(
        await startTicketRefund(db, {
          eventId: id,
          ticketId: ticket.id,
          reason: "",
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_paid" });
    });
  });

  it("ends the ticket when Stripe's dashboard refunds all of it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id, c } = await paidTicket(db, w);
      // A partial refund keeps the ticket.
      await handleStripeEvent(db, refunded(c.session, 200), NOW);
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "paid",
      });
      await handleStripeEvent(db, refunded(c.session, 700), NOW);
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "refunded",
      });
      expect(await creditBalance(db, w.ana)).toBe(500);
      expect(await myTicket(db, id, w.ben, NOW)).toMatchObject({
        status: "offered",
      });
    });
  });

  it("ends a ticket paid only with credit at once, with the credit back", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 1200);
      await buy(db, id, w.ana);
      const ticket = await myTicket(db, id, w.ana, NOW);
      if (!ticket) throw new Error("no ticket");
      expect(await creditBalance(db, w.ana)).toBe(0);
      expect(
        await startTicketRefund(db, {
          eventId: id,
          ticketId: ticket.id,
          reason: "",
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: { kind: "done", creditCents: 1200 } });
      expect(await creditBalance(db, w.ana)).toBe(1200);
      expect(await myTicket(db, id, w.ana, NOW)).toMatchObject({
        status: "refunded",
      });
    });
  });
});

describe("leaving, calling off and deleting", () => {
  it("keeps a ticket holder's spot unless they give the ticket up", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create({ capacity: 1 });
      await grant(db, w.ana, 1200);
      await buy(db, id, w.ana);
      await buy(db, id, w.ben);
      expect(
        await leaveEvent(db, { eventId: id, userId: w.ana, now: NOW }),
      ).toEqual({ ok: false, error: "has_ticket" });
      expect(await deleteAccount(db, w.ana, NOW)).toMatchObject({ ok: true });
      expect(
        (await ticketsOf(db, id)).find((t) => t.userId === w.ana)?.status,
      ).toBe("cancelled");
      expect(await myTicket(db, id, w.ben, NOW)).toMatchObject({
        status: "offered",
      });
    });
  });

  it("passes an offer on to the next person in line", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create({ capacity: 1 });
      const c = await checkout(db, id, w.ana);
      await buy(db, id, w.ben);
      await buy(db, id, w.cy);
      await handleStripeEvent(db, expired(c.session), NOW);
      expect(await myTicket(db, id, w.ben, NOW)).toMatchObject({
        status: "offered",
      });
      expect(
        await leaveEvent(db, { eventId: id, userId: w.ben, now: NOW }),
      ).toEqual({ ok: true, value: { promoted: [w.cy] } });
      expect(await myTicket(db, id, w.ben, NOW)).toBeNull();
      expect(await myTicket(db, id, w.cy, NOW)).toMatchObject({
        status: "offered",
      });
    });
  });

  it("won't call off, delete or make free an event with tickets out", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await checkout(db, id, w.ana);
      expect(await cancelEvent(db, { id, actorId: w.admin, now: NOW })).toEqual(
        { ok: false, error: "has_tickets" },
      );
      expect(await deleteEvent(db, { id, actorId: w.admin, now: NOW })).toEqual(
        { ok: false, error: "has_tickets" },
      );
      expect(
        await updateEvent(db, {
          id,
          event: { ...bowling, title: `Bowling ${w.tag}` },
          reach: everyone,
          prices: { ticketPriceCents: null, memberPriceCents: null },
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "has_tickets" });
      // Once the checkout has run out, the event can be called off.
      expect(
        (await cancelEvent(db, { id, actorId: w.admin, now: LATER })).ok,
      ).toBe(true);
    });
  });
});

describe("check-in and the admin's list", () => {
  it("checks a paid ticket in once by its code, however it was typed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const c = await checkout(db, id, w.ana);
      await handleStripeEvent(db, completed(c.session, c.totalCents), NOW);
      await checkout(db, id, w.ben, { member: false });
      const ticket = await myTicket(db, id, w.ana, NOW);
      const code = ticket?.code ?? "";
      const typed = `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`;
      const checkIn = (text: string) =>
        checkInTicket(db, {
          eventId: id,
          code: text,
          actorId: w.admin,
          now: NOW,
        });
      expect(await checkIn(typed)).toEqual({
        ok: true,
        value: { name: "Ana Example", code },
      });
      expect(await checkIn(code)).toEqual({ ok: false, error: "already_in" });
      expect(await checkIn("nope")).toEqual({ ok: false, error: "bad_code" });
      // Ben's checkout isn't paid, so his code gets no one in.
      const bens = await myTicket(db, id, w.ben, NOW);
      expect(await checkIn(bens?.code ?? "")).toEqual({
        ok: false,
        error: "unknown_code",
      });

      const list = await eventTickets(db, id, NOW);
      expect(list.checkingOut).toBe(1);
      expect(list.offered).toBe(0);
      expect(list.holders).toEqual([
        expect.objectContaining({
          name: "Ana Example",
          status: "paid",
          code,
          priceCents: 1200,
          cardCents: 700,
          creditCents: 500,
          checkedInAt: NOW,
        }),
      ]);
    });
  });
});

/** A connection of its own, committed, for the concurrency test. */
async function connect(clients: Client[]) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  clients.push(client);
  return drizzle({ client, schema, casing: "snake_case" });
}

async function removeWorld(
  db: Db,
  w: { leagueId: LeagueId; people: UserId[] },
) {
  const events = db
    .select({ id: event.id })
    .from(event)
    .where(eq(event.leagueId, w.leagueId));
  const purchases = db
    .select({ id: eventTicket.purchaseId })
    .from(eventTicket)
    .where(inArray(eventTicket.eventId, events));
  const purchaseIds = (await purchases).flatMap((p) => (p.id ? [p.id] : []));
  await db.delete(creditEntry).where(inArray(creditEntry.userId, w.people));
  await db.delete(message).where(inArray(message.userId, w.people));
  await db.delete(eventTicket).where(inArray(eventTicket.eventId, events));
  if (purchaseIds.length > 0)
    await db.delete(purchase).where(inArray(purchase.id, purchaseIds));
  await db.delete(eventRsvp).where(inArray(eventRsvp.eventId, events));
  await db.delete(event).where(eq(event.leagueId, w.leagueId));
  await db.delete(league).where(eq(league.id, w.leagueId));
  await db.delete(user).where(inArray(user.id, w.people));
}

describe("buyers for the last spots at once", () => {
  it("never holds more spots than the capacity", async () => {
    const clients: Client[] = [];
    const setup = await connect(clients);
    const w = await world(setup);
    const people = [w.admin, w.ana, w.ben, w.cy, w.di, w.eve];
    try {
      const id = await w.create({ capacity: 2 });
      const buyers = [w.ana, w.ben, w.cy, w.di, w.eve];
      const conns = await Promise.all(buyers.map(() => connect(clients)));
      const results = await Promise.all(
        buyers.map((userId, i) =>
          conns[i]!.transaction((tx) => buy(tx, id, userId)),
        ),
      );
      const kinds = results.map((r) => (r.ok ? r.value.kind : r.error));
      expect(kinds.filter((k) => k === "checkout")).toHaveLength(2);
      expect(kinds.filter((k) => k === "waitlisted")).toHaveLength(3);
      // The line is in the order the lock let them in: 1, 2, 3.
      const places = results
        .flatMap((r) =>
          r.ok && r.value.kind === "waitlisted" ? [r.value.position] : [],
        )
        .sort();
      expect(places).toEqual([1, 2, 3]);
      expect(await spotCounts(setup, { id, capacity: 2 }, NOW)).toEqual({
        capacity: 2,
        going: 0,
        held: 2,
        waitlisted: 3,
      });
    } finally {
      await removeWorld(setup, { leagueId: w.leagueId, people });
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
