import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type {
  LeagueId,
  MerchItemId,
  PurchaseId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import type { ItemValues } from "@/domain/merch/catalog";
import * as schema from "../schema";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { creditEntry } from "../schema/credit";
import { league } from "../schema/league";
import { merchItem, merchOrder } from "../schema/merch";
import { message } from "../schema/message";
import { payment, purchase, refund, webhookEvent } from "../schema/money";
import { team, teamSeason } from "../schema/team";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount } from "./account";
import { creditBalance } from "./credit";
import {
  addMerchPhoto,
  catalog,
  catalogItem,
  createMerchItem,
  finishMerchRefund,
  fulfillMerchOrders,
  merchOrders,
  myMerchOrders,
  placeMerchOrder,
  playerTeams,
  removeMerchPhoto,
  setItemHidden,
  startMerchRefund,
  updateMerchItem,
} from "./merch";
import {
  attachCheckoutSession,
  expirePurchases,
  handleStripeEvent,
} from "./payments";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2027-03-01T17:00:00Z");
const LATER = new Date("2027-03-01T19:00:00Z");

const SHIRT: ItemValues = {
  kind: "league",
  name: "League shirt",
  description: "Soft and loud.",
  priceCents: 2500,
  memberPriceCents: 2000,
  madeToOrder: false,
  orderDeadline: null,
  sizes: [
    { size: "m", stock: 2 },
    { size: "l", stock: 1 },
  ],
};

const JERSEY: ItemValues = {
  kind: "team_jersey",
  name: "Replacement jersey",
  description: null,
  priceCents: 1800,
  memberPriceCents: null,
  madeToOrder: true,
  orderDeadline: null,
  sizes: [
    { size: "m", stock: 0 },
    { size: "l", stock: 0 },
  ],
};

/** An invented league with an admin and five shoppers. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Shop League", slug: `shop-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  const people = await db
    .insert(user)
    .values(
      ["Admin", "Ana", "Ben", "Cy", "Di", "Eve"].map((name, i) => ({
        name: `${name} Example`,
        email: `shop-${i}-${tag}@example.test`,
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
  const create = (values: Partial<ItemValues> = {}) =>
    createMerchItem(db, {
      leagueId: lg.id,
      values: { ...SHIRT, ...values },
      actorId: admin,
    });
  return { leagueId: lg.id, admin, ana, ben, cy, di, eve, create };
}

const order = (
  db: Db,
  leagueId: LeagueId,
  itemId: MerchItemId,
  userId: UserId,
  options: {
    size?: string;
    quantity?: string;
    member?: boolean;
    useCredit?: boolean;
    teamSeasonId?: TeamSeasonId | null;
    now?: Date;
  } = {},
) =>
  placeMerchOrder(db, {
    leagueId,
    itemId,
    userId,
    member: options.member ?? true,
    size: options.size ?? "m",
    quantity: options.quantity ?? "1",
    teamSeasonId: options.teamSeasonId ?? null,
    useCredit: options.useCredit ?? true,
    now: options.now ?? NOW,
  });

/** Orders and expects a checkout, which gets a Stripe session id. */
async function checkout(...args: Parameters<typeof order>) {
  const [db] = args;
  const result = await order(...args);
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
  id: `evt_merch_${Date.now()}_${++sequence}`,
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

async function statusOf(db: Db, id: PurchaseId) {
  const [row] = await db
    .select({ status: purchase.status })
    .from(purchase)
    .where(eq(purchase.id, id));
  return row?.status;
}

async function orderStatus(db: Db, purchaseId: PurchaseId) {
  const [row] = await db
    .select({ status: merchOrder.status })
    .from(merchOrder)
    .where(eq(merchOrder.purchaseId, purchaseId));
  return row?.status;
}

/** Merch emails queued for a person, as `template/kind`. */
async function mail(db: Db, userId: UserId) {
  const rows = await db
    .select({ template: message.template, payload: message.payload })
    .from(message)
    .where(
      and(
        eq(message.userId, userId),
        inArray(message.template, ["merch_receipt", "merch_update"]),
      ),
    )
    .orderBy(message.createdAt);
  return rows.map((r) => `${r.template}/${String(r.payload.kind)}`);
}

const leftOf = async (db: Db, leagueId: LeagueId, itemId: MerchItemId) => {
  const item = await catalogItem(db, leagueId, itemId, NOW, { hidden: true });
  return Object.fromEntries(item?.sizes.map((s) => [s.size, s.left]) ?? []);
};

describe("the catalog", () => {
  it("adds, changes and hides items, with an audit row each time", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      expect(await leftOf(db, w.leagueId, id)).toEqual({ m: 2, l: 1 });
      expect(
        await updateMerchItem(db, {
          leagueId: w.leagueId,
          itemId: id,
          values: { ...SHIRT, sizes: [{ size: "xl", stock: 5 }] },
          actorId: w.admin,
        }),
      ).toEqual({ ok: true, value: undefined });
      expect(await leftOf(db, w.leagueId, id)).toEqual({ xl: 5 });
      await setItemHidden(db, {
        leagueId: w.leagueId,
        itemId: id,
        hidden: true,
        actorId: w.admin,
        now: NOW,
      });
      expect(
        await catalog(db, w.leagueId, NOW, { hidden: false }),
      ).toHaveLength(0);
      expect(await catalog(db, w.leagueId, NOW, { hidden: true })).toHaveLength(
        1,
      );
      expect(await order(db, w.leagueId, id, w.ana, { size: "xl" })).toEqual({
        ok: false,
        error: "hidden",
      });
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, id))
        .orderBy(auditLog.occurredAt);
      expect(audit.map((a) => a.action)).toEqual([
        "merch.item_create",
        "merch.item_update",
        "merch.item_hide",
      ]);
    });
  });

  it("won't change another league's item", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await world(db);
      const id = await w.create();
      expect(
        await updateMerchItem(db, {
          leagueId: other.leagueId,
          itemId: id,
          values: SHIRT,
          actorId: other.admin,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(await order(db, other.leagueId, id, other.ana)).toEqual({
        ok: false,
        error: "not_found",
      });
    });
  });

  it("refuses a price or stock the database would never take", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await expect(w.create({ priceCents: 10 })).rejects.toThrow();
    });
  });

  it("caps photos per item, and serves them only while the item is shown", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      const add = () =>
        addMerchPhoto(db, {
          leagueId: w.leagueId,
          itemId: id,
          bytes: Buffer.from("webp bytes"),
          alt: "The shirt, front",
          actorId: w.admin,
        });
      const first = await add();
      for (let i = 0; i < 3; i++) expect((await add()).ok).toBe(true);
      expect(await add()).toEqual({ ok: false, error: "too_many" });
      if (!first.ok) throw new Error("no photo");
      expect(
        await removeMerchPhoto(db, {
          leagueId: w.leagueId,
          itemId: id,
          imageId: first.value,
          actorId: w.admin,
        }),
      ).toEqual({ ok: true, value: undefined });
      expect((await add()).ok).toBe(true);
      const item = await catalogItem(db, w.leagueId, id, NOW, {
        hidden: true,
      });
      expect(item?.photos).toHaveLength(4);
      expect(
        await addMerchPhoto(db, {
          leagueId: w.leagueId,
          itemId: await w.create(),
          bytes: Buffer.from("x"),
          alt: "  ",
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "alt" });
    });
  });
});

describe("placing an order", () => {
  it("holds the stock and starts a checkout for the member price less credit", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const c = await checkout(db, w.leagueId, id, w.ana, { quantity: "2" });
      expect(c).toMatchObject({
        totalCents: 3500,
        creditCents: 500,
        description: "League shirt (M) × 2",
      });
      expect(await creditBalance(db, w.ana)).toBe(0);
      expect(await leftOf(db, w.leagueId, id)).toEqual({ m: 0, l: 1 });
      expect(await order(db, w.leagueId, id, w.ben)).toEqual({
        ok: false,
        error: "sold_out",
      });
      // Back for the same item: carry on with the checkout already open.
      expect(await order(db, w.leagueId, id, w.ana, { size: "l" })).toEqual({
        ok: true,
        value: { kind: "open_checkout", purchaseId: c.purchaseId },
      });
    });
  });

  it("charges people who aren't members the full price, and skips credit when asked", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const c = await checkout(db, w.leagueId, id, w.ana, {
        member: false,
        useCredit: false,
      });
      expect(c).toMatchObject({ totalCents: 2500, creditCents: 0 });
      expect(await creditBalance(db, w.ana)).toBe(500);
    });
  });

  it("places the order at once when credit covers it, with a receipt", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 5000);
      const result = await order(db, w.leagueId, id, w.ana);
      expect(result.ok && result.value.kind).toBe("paid");
      expect(await creditBalance(db, w.ana)).toBe(3000);
      expect(await mail(db, w.ana)).toEqual(["merch_receipt/receipt"]);
      const [mine] = await myMerchOrders(db, w.ana, NOW);
      expect(mine).toMatchObject({
        status: "paid",
        description: "League shirt (M)",
        creditCents: 2000,
        totalCents: 0,
      });
    });
  });

  it("closes orders at the deadline, and takes no order past the stock", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const closed = await w.create({ orderDeadline: NOW });
      expect(await order(db, w.leagueId, closed, w.ana)).toEqual({
        ok: false,
        error: "closed",
      });
      const id = await w.create();
      expect(await order(db, w.leagueId, id, w.ana, { size: "xs" })).toEqual({
        ok: false,
        error: "size",
      });
      expect(await order(db, w.leagueId, id, w.ana, { quantity: "3" })).toEqual(
        { ok: false, error: "sold_out" },
      );
      expect(await order(db, w.leagueId, id, w.ana, { quantity: "9" })).toEqual(
        { ok: false, error: "quantity" },
      );
    });
  });

  it("frees a lapsed checkout's stock and credit even when no webhook came", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const c = await checkout(db, w.leagueId, id, w.ana, { quantity: "2" });
      const result = await order(db, w.leagueId, id, w.ben, {
        quantity: "2",
        now: LATER,
      });
      expect(result.ok && result.value.kind).toBe("checkout");
      expect(await orderStatus(db, c.purchaseId)).toBe("released");
      expect(await statusOf(db, c.purchaseId)).toBe("expired");
      expect(await creditBalance(db, w.ana)).toBe(500);
    });
  });
});

describe("replacement jerseys", () => {
  it("default to the player's team and its color, and need a team", async () => {
    await inRolledBackDb(async (db) => {
      const lw = await leagueWorld(db);
      await db
        .update(team)
        .set({ colorHex: "#FF6600" })
        .where(
          inArray(
            team.id,
            db
              .select({ id: teamSeason.teamId })
              .from(teamSeason)
              .where(eq(teamSeason.id, lw.teamSeasonId)),
          ),
        );
      const jersey = await createMerchItem(db, {
        leagueId: lw.leagueId,
        values: JERSEY,
        actorId: lw.admin,
      });
      expect(await playerTeams(db, lw.teammate)).toEqual([
        {
          teamSeasonId: lw.teamSeasonId,
          name: "Kick Bottom",
          colorHex: "#FF6600",
          seasonName: "Spring 2027",
        },
      ]);
      const c = await checkout(db, lw.leagueId, jersey, lw.teammate, {
        size: "l",
      });
      expect(c.description).toBe("Replacement jersey (L), Kick Bottom");
      const [row] = await db
        .select({
          teamSeasonId: merchOrder.teamSeasonId,
          teamName: merchOrder.teamName,
          colorHex: merchOrder.colorHex,
        })
        .from(merchOrder)
        .where(eq(merchOrder.purchaseId, c.purchaseId));
      expect(row).toEqual({
        teamSeasonId: lw.teamSeasonId,
        teamName: "Kick Bottom",
        colorHex: "#FF6600",
      });
      // Not on that team: refused. Not on any team: refused.
      expect(
        await order(db, lw.leagueId, jersey, lw.captain, {
          teamSeasonId: lw.otherTeamSeasonId,
        }),
      ).toEqual({ ok: false, error: "team" });
      expect(await order(db, lw.leagueId, jersey, lw.agent)).toEqual({
        ok: false,
        error: "no_team",
      });
      // Made to order: no stock limit.
      expect(
        (await order(db, lw.leagueId, jersey, lw.captain, { quantity: "5" }))
          .ok,
      ).toBe(true);
    });
  });
});

describe("the Stripe webhook for merch", () => {
  it("marks the order paid once, however often the event is replayed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const c = await checkout(db, w.leagueId, id, w.ana);
      const paid = completed(c.session, c.totalCents);
      expect(await handleStripeEvent(db, paid, NOW)).toBe("processed");
      expect(await handleStripeEvent(db, paid, NOW)).toBe("duplicate");
      expect(await statusOf(db, c.purchaseId)).toBe("paid");
      expect(await orderStatus(db, c.purchaseId)).toBe("paid");
      const payments = await db
        .select({ amount: payment.amountCents })
        .from(payment)
        .where(eq(payment.purchaseId, c.purchaseId));
      expect(payments).toEqual([{ amount: 1500 }]);
      expect(await mail(db, w.ana)).toEqual(["merch_receipt/receipt"]);
      const [receipt] = await db
        .select({ payload: message.payload })
        .from(message)
        .where(eq(message.userId, w.ana));
      expect(receipt?.payload).toMatchObject({
        description: "League shirt (M)",
        paid: "$15 on your card and $5 of league credit",
      });
      const recorded = await db
        .select({ id: webhookEvent.id })
        .from(webhookEvent)
        .where(eq(webhookEvent.eventId, paid.id));
      expect(recorded).toHaveLength(1);
    });
  });

  it("puts an expired checkout's stock and credit back", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 500);
      const c = await checkout(db, w.leagueId, id, w.ana, { quantity: "2" });
      expect(await handleStripeEvent(db, expired(c.session), NOW)).toBe(
        "processed",
      );
      expect(await orderStatus(db, c.purchaseId)).toBe("released");
      expect(await creditBalance(db, w.ana)).toBe(500);
      expect(await leftOf(db, w.leagueId, id)).toEqual({ m: 2, l: 1 });
      expect(await myMerchOrders(db, w.ana, NOW)).toEqual([]);
    });
  });

  it("gives the stock back when a buyer's checkout is replaced", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      const c = await checkout(db, w.leagueId, id, w.ana, { quantity: "2" });
      await expirePurchases(db, [c.purchaseId], NOW);
      expect(await leftOf(db, w.leagueId, id)).toEqual({ m: 2, l: 1 });
    });
  });
});

describe("fulfilling and refunding", () => {
  async function paidOrder(db: Db, w: Awaited<ReturnType<typeof world>>) {
    const id = await w.create();
    await grant(db, w.ana, 500);
    const c = await checkout(db, w.leagueId, id, w.ana);
    await handleStripeEvent(db, completed(c.session, c.totalCents), NOW);
    const [o] = await merchOrders(db, w.leagueId, { itemId: id });
    if (!o) throw new Error("no order");
    return { id, c, o };
  }

  it("lists paid orders for the admin and marks them fulfilled once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id, o } = await paidOrder(db, w);
      expect(o).toMatchObject({
        itemName: "League shirt",
        name: "Ana Example",
        size: "m",
        quantity: 1,
        status: "paid",
        unitPriceCents: 2000,
        creditCents: 500,
        cardCents: 1500,
      });
      const fulfill = () =>
        fulfillMerchOrders(db, {
          leagueId: w.leagueId,
          itemId: id,
          orderIds: [o.id],
          actorId: w.admin,
          now: LATER,
        });
      expect(await fulfill()).toEqual({ ok: true, value: 1 });
      expect(await fulfill()).toEqual({ ok: true, value: 0 });
      expect(await merchOrders(db, w.leagueId, { statuses: ["paid"] })).toEqual(
        [],
      );
      expect(await mail(db, w.ana)).toEqual([
        "merch_receipt/receipt",
        "merch_update/fulfilled",
      ]);
      const audit = await db
        .select({ action: auditLog.action, actor: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.entityId, o.id));
      expect(audit).toEqual([
        { action: "merch.order_fulfill", actor: w.admin },
      ]);
      // A fulfilled shirt still counts against the stock.
      expect(await leftOf(db, w.leagueId, id)).toEqual({ m: 1, l: 1 });
    });
  });

  it("refunds the card through the refund flow, gives the credit back and frees the stock", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { id, c, o } = await paidOrder(db, w);
      const started = await startMerchRefund(db, {
        leagueId: w.leagueId,
        itemId: id,
        orderId: o.id,
        reason: "Wrong size",
        actorId: w.admin,
      });
      if (!started.ok || started.value.kind !== "stripe")
        throw new Error("no Stripe refund");
      expect(started.value).toMatchObject({
        paymentIntentId: `pi_${c.session}`,
        amountCents: 1500,
      });
      expect(await orderStatus(db, c.purchaseId)).toBe("paid");
      const { refundId } = started.value;
      const finish = () =>
        finishMerchRefund(db, {
          itemId: id,
          orderId: o.id,
          refundId,
          stripeRefundId: "re_merch_1",
          amountCents: 1500,
          actorId: w.admin,
        });
      await finish();
      await finish();
      expect(await orderStatus(db, c.purchaseId)).toBe("refunded");
      expect(await creditBalance(db, w.ana)).toBe(500);
      expect(await leftOf(db, w.leagueId, id)).toEqual({ m: 2, l: 1 });
      expect(await mail(db, w.ana)).toEqual([
        "merch_receipt/receipt",
        "merch_update/refunded",
      ]);
      const [row] = await db
        .select({ amount: refund.amountCents })
        .from(refund)
        .where(eq(refund.stripeRefundId, "re_merch_1"));
      expect(row).toEqual({ amount: 1500 });
      // Stripe's charge.refunded follows and only settles the money.
      expect(await handleStripeEvent(db, refunded(c.session, 1500), NOW)).toBe(
        "processed",
      );
      expect(await statusOf(db, c.purchaseId)).toBe("refunded");
      expect(await mail(db, w.ana)).toHaveLength(2);
      expect(
        await startMerchRefund(db, {
          leagueId: w.leagueId,
          itemId: id,
          orderId: o.id,
          reason: "",
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "not_paid" });
    });
  });

  it("ends the order when Stripe's dashboard refunds all of it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { c } = await paidOrder(db, w);
      await handleStripeEvent(db, refunded(c.session, 500), NOW);
      expect(await orderStatus(db, c.purchaseId)).toBe("paid");
      await handleStripeEvent(db, refunded(c.session, 1500), NOW);
      expect(await orderStatus(db, c.purchaseId)).toBe("refunded");
      expect(await creditBalance(db, w.ana)).toBe(500);
    });
  });

  it("ends an order paid only with credit at once, with the credit back", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await grant(db, w.ana, 2000);
      const placed = await order(db, w.leagueId, id, w.ana);
      if (!placed.ok || placed.value.kind !== "paid") throw new Error("unpaid");
      expect(
        await startMerchRefund(db, {
          leagueId: w.leagueId,
          itemId: id,
          orderId: placed.value.orderId,
          reason: "",
          actorId: w.admin,
        }),
      ).toEqual({ ok: true, value: { kind: "done", creditCents: 2000 } });
      expect(await creditBalance(db, w.ana)).toBe(2000);
    });
  });

  it("won't refund or fulfill another league's order", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await world(db);
      const { id, o } = await paidOrder(db, w);
      expect(
        await startMerchRefund(db, {
          leagueId: other.leagueId,
          itemId: id,
          orderId: o.id,
          reason: "",
          actorId: other.admin,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await fulfillMerchOrders(db, {
          leagueId: other.leagueId,
          itemId: id,
          orderIds: null,
          actorId: other.admin,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_found" });
    });
  });
});

describe("deleting an account", () => {
  it("puts held stock back and keeps paid orders", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.create();
      await checkout(db, w.leagueId, id, w.ana, { quantity: "2" });
      const hat = await w.create({ name: "Hat" });
      await grant(db, w.ana, 2000);
      const paid = await order(db, w.leagueId, hat, w.ana, { size: "l" });
      expect(paid.ok && paid.value.kind).toBe("paid");
      expect((await deleteAccount(db, w.ana, NOW)).ok).toBe(true);
      expect(await leftOf(db, w.leagueId, id)).toEqual({ m: 2, l: 1 });
      expect(await leftOf(db, w.leagueId, hat)).toEqual({ m: 2, l: 0 });
      expect(await merchOrders(db, w.leagueId)).toHaveLength(1);
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
  const purchaseIds = (
    await db
      .select({ id: merchOrder.purchaseId })
      .from(merchOrder)
      .innerJoin(merchItem, eq(merchItem.id, merchOrder.itemId))
      .where(eq(merchItem.leagueId, w.leagueId))
  ).map((p) => p.id);
  await db.delete(creditEntry).where(inArray(creditEntry.userId, w.people));
  await db.delete(message).where(inArray(message.userId, w.people));
  await db.delete(auditLog).where(inArray(auditLog.actorId, w.people));
  if (purchaseIds.length > 0) {
    await db
      .delete(merchOrder)
      .where(inArray(merchOrder.purchaseId, purchaseIds));
    await db.delete(purchase).where(inArray(purchase.id, purchaseIds));
  }
  await db.delete(merchItem).where(eq(merchItem.leagueId, w.leagueId));
  await db.delete(league).where(eq(league.id, w.leagueId));
  await db.delete(user).where(inArray(user.id, w.people));
}

describe("buyers for the last shirts at once", () => {
  it("never sells more than the stock", async () => {
    const clients: Client[] = [];
    const setup = await connect(clients);
    const w = await world(setup);
    const people = [w.admin, w.ana, w.ben, w.cy, w.di, w.eve];
    try {
      const id = await w.create();
      const buyers = [w.ana, w.ben, w.cy, w.di, w.eve];
      const conns = await Promise.all(buyers.map(() => connect(clients)));
      const results = await Promise.all(
        buyers.map((userId, i) =>
          conns[i]!.transaction((tx) => order(tx, w.leagueId, id, userId)),
        ),
      );
      const kinds = results.map((r) => (r.ok ? r.value.kind : r.error));
      expect(kinds.filter((k) => k === "checkout")).toHaveLength(2);
      expect(kinds.filter((k) => k === "sold_out")).toHaveLength(3);
      expect(await leftOf(setup, w.leagueId, id)).toEqual({ m: 0, l: 1 });
    } finally {
      await removeWorld(setup, { leagueId: w.leagueId, people });
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
