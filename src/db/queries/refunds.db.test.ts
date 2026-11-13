import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type {
  PromoCodeId,
  PurchaseId,
  RegistrationId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import type { CheckoutItem } from "@/domain/registration/checkout";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { payment, purchase, refund } from "../schema/money";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  attachCheckoutSession,
  handleStripeEvent,
  purchaseStatus,
  recordOffAppPayment,
  startPurchase,
} from "./payments";
import {
  createPromoCode,
  disablePromoCode,
  promoCodesForSeason,
} from "./promo-codes";
import { confirmStripeRefund, dropRefund, startRefund } from "./refunds";
import { registrationsBoard } from "./registrations-admin";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");

/** A season with a $85 player fee and players ready to pay it. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `admin-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `refund-${tag}` })
    .returning({ id: league.id });
  const [s] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
      name: "Spring",
      slug: "spring",
      status: "registration_open",
      startsOn: "2027-04-05",
      endsOn: "2027-06-28",
      feeModel: "per_player",
      playerFeeCents: 8500,
      rosterMin: 1,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  const seasonId = s!.id;
  let n = 0;
  const player = async () => {
    n += 1;
    const [p] = await db
      .insert(user)
      .values({ name: `Player ${n}`, email: `p${n}-${tag}@example.test` })
      .returning({ id: user.id });
    const [r] = await db
      .insert(registration)
      .values({
        seasonId,
        userId: p!.id,
        kind: "free_agent",
        status: "pending_payment",
      })
      .returning({ id: registration.id });
    const items: CheckoutItem[] = [
      {
        kind: "free_agent_fee",
        amountCents: 8500,
        description: "Spring: free agent",
        registrationId: r!.id,
        teamSeasonId: null,
      },
    ];
    return { userId: p!.id, registrationId: r!.id, items };
  };
  return { tag, seasonId, adminId: admin!.id, player };
}

type Player = {
  userId: UserId;
  registrationId: RegistrationId;
  items: CheckoutItem[];
};

const start = (
  db: Db,
  seasonId: SeasonId,
  p: Player,
  promoCode: string | null,
) =>
  startPurchase(db, {
    userId: p.userId,
    seasonId,
    items: p.items,
    promoCode,
    now: NOW,
  });

async function addCode(
  db: Db,
  seasonId: SeasonId,
  adminId: UserId,
  over: Partial<{
    code: string;
    kind: "percent" | "amount";
    value: number;
    maxRedemptions: number | null;
    validUntil: Date | null;
  }> = {},
): Promise<PromoCodeId> {
  const created = await createPromoCode(db, {
    seasonId,
    actorId: adminId,
    promo: {
      code: "SPRING10",
      kind: "percent",
      value: 10,
      maxRedemptions: null,
      validUntil: null,
      ...over,
    },
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

/** Pays a purchase through Stripe's webhook, as Checkout would. */
async function payByStripe(
  db: Db,
  purchaseId: PurchaseId,
  sessionId: string,
  totalCents: number,
) {
  await attachCheckoutSession(db, purchaseId, sessionId);
  await handleStripeEvent(
    db,
    {
      id: `evt_paid_${sessionId}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          payment_status: "paid",
          payment_intent: `pi_${sessionId}`,
          amount_total: totalCents,
        },
      },
    },
    NOW,
  );
  const [paid] = await db
    .select({ id: payment.id })
    .from(payment)
    .where(eq(payment.stripePaymentIntentId, `pi_${sessionId}`));
  return paid!.id;
}

const refunded = (id: string, intent: string, amountRefunded: number) => ({
  id,
  type: "charge.refunded",
  data: {
    object: {
      id: `ch_${intent}`,
      payment_intent: intent,
      amount_refunded: amountRefunded,
    },
  },
});

describe("promo codes", () => {
  it("takes a code off the purchase and the line items, matching case-insensitively", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await addCode(db, w.seasonId, w.adminId);
      const started = await start(
        db,
        w.seasonId,
        await w.player(),
        " spring10 ",
      );
      if (!started.ok) throw new Error(started.error);
      expect(started.value.totalCents).toBe(7650);
      expect(started.value.chargeCents).toEqual([7650]);
      const [row] = await db
        .select({
          subtotal: purchase.subtotalCents,
          discount: purchase.discountCents,
          total: purchase.totalCents,
          status: purchase.status,
        })
        .from(purchase)
        .where(eq(purchase.id, started.value.purchaseId));
      expect(row).toEqual({
        subtotal: 8500,
        discount: 850,
        total: 7650,
        status: "open",
      });
    });
  });

  it("charges full price with no code, and refuses unknown, expired, turned-off and used-up codes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const plain = await start(db, w.seasonId, await w.player(), "");
      expect(plain.ok && plain.value.totalCents).toBe(8500);

      expect(await start(db, w.seasonId, await w.player(), "NOPE")).toEqual({
        ok: false,
        error: "unknown_code",
      });
      await addCode(db, w.seasonId, w.adminId, {
        code: "OLD",
        validUntil: new Date("2027-02-01T00:00:00Z"),
      });
      expect(await start(db, w.seasonId, await w.player(), "old")).toEqual({
        ok: false,
        error: "expired",
      });
      const off = await addCode(db, w.seasonId, w.adminId, { code: "GONE" });
      expect(
        await disablePromoCode(db, {
          seasonId: w.seasonId,
          id: off,
          actorId: w.adminId,
          now: NOW,
        }),
      ).toBe(true);
      expect(await start(db, w.seasonId, await w.player(), "GONE")).toEqual({
        ok: false,
        error: "unknown_code",
      });

      await addCode(db, w.seasonId, w.adminId, {
        code: "TWICE",
        kind: "amount",
        value: 1500,
        maxRedemptions: 2,
      });
      const first = await start(db, w.seasonId, await w.player(), "TWICE");
      await start(db, w.seasonId, await w.player(), "TWICE");
      expect(await start(db, w.seasonId, await w.player(), "TWICE")).toEqual({
        ok: false,
        error: "used_up",
      });
      // An abandoned checkout gives its use back.
      if (first.ok)
        await db
          .update(purchase)
          .set({ status: "expired" })
          .where(eq(purchase.id, first.value.purchaseId));
      const again = await start(db, w.seasonId, await w.player(), "TWICE");
      expect(again.ok && again.value.totalCents).toBe(7000);

      const codes = await promoCodesForSeason(db, w.seasonId);
      // Made in one transaction, so they share a time and sort by code.
      expect(
        codes.map((c) => [c.code, c.redemptions, c.disabledAt !== null]),
      ).toEqual([
        ["GONE", 0, true],
        ["OLD", 0, false],
        ["TWICE", 2, false],
      ]);
    });
  });

  it("settles a purchase the code covers in full, with no payment", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await addCode(db, w.seasonId, w.adminId, { code: "FREE", value: 100 });
      const p = await w.player();
      const started = await start(db, w.seasonId, p, "FREE");
      if (!started.ok) throw new Error(started.error);
      expect(started.value.totalCents).toBe(0);
      expect(await purchaseStatus(db, started.value.purchaseId)).toMatchObject({
        status: "paid",
      });
      const [reg] = await db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, p.registrationId));
      expect(reg?.status).toBe("active");
      expect(
        await db
          .select()
          .from(payment)
          .where(eq(payment.purchaseId, started.value.purchaseId)),
      ).toEqual([]);
    });
  });

  it("refuses the same code twice in a season and audits each change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await addCode(db, w.seasonId, w.adminId);
      expect(
        await createPromoCode(db, {
          seasonId: w.seasonId,
          actorId: w.adminId,
          promo: {
            code: "SPRING10",
            kind: "amount",
            value: 500,
            maxRedemptions: null,
            validUntil: null,
          },
        }),
      ).toEqual({ ok: false, error: "duplicate" });
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audits).toEqual([{ action: "promo_code.create" }]);
    });
  });
});

describe("refunds", () => {
  it("refunds part of a Stripe payment, then the rest, as Stripe's webhook confirms", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = await w.player();
      const started = await start(db, w.seasonId, p, null);
      if (!started.ok) throw new Error(started.error);
      const sessionId = `cs_${w.tag}`;
      const paymentId = await payByStripe(
        db,
        started.value.purchaseId,
        sessionId,
        8500,
      );

      const partial = await startRefund(db, {
        seasonId: w.seasonId,
        paymentId,
        amount: "20",
        reason: "Missed the first two weeks",
        actorId: w.adminId,
      });
      expect(partial).toMatchObject({
        ok: true,
        value: {
          kind: "stripe",
          paymentIntentId: `pi_${sessionId}`,
          amountCents: 2000,
        },
      });
      if (!partial.ok || partial.value.kind !== "stripe") throw new Error();
      await confirmStripeRefund(db, {
        refundId: partial.value.refundId,
        stripeRefundId: `re_a_${w.tag}`,
        actorId: w.adminId,
      });
      // Until Stripe confirms, the purchase is still paid but the money is spoken for.
      expect(await purchaseStatus(db, started.value.purchaseId)).toMatchObject({
        status: "paid",
      });
      expect(
        await startRefund(db, {
          seasonId: w.seasonId,
          paymentId,
          amount: "70",
          reason: "",
          actorId: w.adminId,
        }),
      ).toEqual({ ok: false, error: "too_much" });

      const intent = `pi_${sessionId}`;
      expect(
        await handleStripeEvent(
          db,
          refunded(`evt_r1_${w.tag}`, intent, 2000),
          NOW,
        ),
      ).toBe("processed");
      expect(
        await handleStripeEvent(
          db,
          refunded(`evt_r1_${w.tag}`, intent, 2000),
          NOW,
        ),
      ).toBe("duplicate");
      expect(await purchaseStatus(db, started.value.purchaseId)).toMatchObject({
        status: "partially_refunded",
      });

      const rest = await startRefund(db, {
        seasonId: w.seasonId,
        paymentId,
        amount: "",
        reason: null,
        actorId: w.adminId,
      });
      expect(rest).toMatchObject({ ok: true, value: { amountCents: 6500 } });
      if (!rest.ok) throw new Error();
      await confirmStripeRefund(db, {
        refundId: rest.value.refundId,
        stripeRefundId: `re_b_${w.tag}`,
        actorId: w.adminId,
      });
      await handleStripeEvent(
        db,
        refunded(`evt_r2_${w.tag}`, intent, 8500),
        NOW,
      );
      // An older event arriving late never lowers the total.
      await handleStripeEvent(
        db,
        refunded(`evt_r0_${w.tag}`, intent, 2000),
        NOW,
      );
      expect(await purchaseStatus(db, started.value.purchaseId)).toMatchObject({
        status: "refunded",
      });
      const [paid] = await db
        .select({
          refunded: payment.refundedCents,
          charge: payment.stripeChargeId,
        })
        .from(payment)
        .where(eq(payment.id, paymentId));
      expect(paid).toEqual({ refunded: 8500, charge: `ch_${intent}` });
      expect(
        await startRefund(db, {
          seasonId: w.seasonId,
          paymentId,
          amount: "",
          reason: null,
          actorId: w.adminId,
        }),
      ).toEqual({ ok: false, error: "nothing_left" });

      const audits = await db
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, paymentId));
      expect(audits.map((a) => a.action)).toEqual([
        "refund.issue",
        "refund.issue",
      ]);
      // Both rows share the transaction's time, so find the first refund's
      // row by its Stripe id rather than by position.
      expect(audits).toContainEqual({
        action: "refund.issue",
        after: expect.objectContaining({
          stripeRefundId: `re_a_${w.tag}`,
          amountCents: 2000,
          reason: "Missed the first two weeks",
        }),
      });

      const board = await registrationsBoard(db, w.seasonId);
      const person = board.freeAgents.find(
        (f) => f.registrationId === p.registrationId,
      );
      expect(person?.payments).toEqual([
        {
          paymentId,
          method: "stripe",
          amountCents: 8500,
          refundedCents: 8500,
          requestedCents: 8500,
        },
      ]);
      expect(person?.paidBy).toBe("stripe");
    });
  });

  it("gives the amount back when Stripe refuses, and ignores refunds of unknown charges", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = await w.player();
      const started = await start(db, w.seasonId, p, null);
      if (!started.ok) throw new Error(started.error);
      const paymentId = await payByStripe(
        db,
        started.value.purchaseId,
        `cs_${w.tag}`,
        8500,
      );
      const first = await startRefund(db, {
        seasonId: w.seasonId,
        paymentId,
        amount: "",
        reason: null,
        actorId: w.adminId,
      });
      if (!first.ok) throw new Error();
      await dropRefund(db, first.value.refundId);
      expect(
        await db.select().from(refund).where(eq(refund.paymentId, paymentId)),
      ).toEqual([]);
      const again = await startRefund(db, {
        seasonId: w.seasonId,
        paymentId,
        amount: "",
        reason: null,
        actorId: w.adminId,
      });
      expect(again).toMatchObject({ ok: true, value: { amountCents: 8500 } });

      expect(
        await handleStripeEvent(
          db,
          refunded(`evt_u_${w.tag}`, "pi_unknown", 100),
          NOW,
        ),
      ).toBe("ignored");
    });
  });

  it("marks an off-app payment refunded at once, with the admin's note", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const p = await w.player();
      const purchaseId = await recordOffAppPayment(db, {
        userId: p.userId,
        seasonId: w.seasonId,
        registrationId: p.registrationId,
        items: p.items,
        method: "venmo",
        note: "Sent to the league account",
        actorId: w.adminId,
        now: NOW,
      });
      const [paid] = await db
        .select({ id: payment.id })
        .from(payment)
        .where(eq(payment.purchaseId, purchaseId));
      const result = await startRefund(db, {
        seasonId: w.seasonId,
        paymentId: paid!.id,
        amount: "$85",
        reason: "Moved away; Venmo sent back",
        actorId: w.adminId,
      });
      expect(result).toMatchObject({
        ok: true,
        value: { kind: "off_app", amountCents: 8500 },
      });
      expect(await purchaseStatus(db, purchaseId)).toMatchObject({
        status: "refunded",
      });
      const [row] = await db
        .select({ reason: refund.reason, stripe: refund.stripeRefundId })
        .from(refund)
        .where(eq(refund.paymentId, paid!.id));
      expect(row).toEqual({
        reason: "Moved away; Venmo sent back",
        stripe: null,
      });
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, paid!.id));
      expect(audits).toEqual([{ action: "refund.issue" }]);
    });
  });

  it("refuses a payment from another season", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await world(db);
      const p = await w.player();
      const started = await start(db, w.seasonId, p, null);
      if (!started.ok) throw new Error(started.error);
      const paymentId = await payByStripe(
        db,
        started.value.purchaseId,
        `cs_${w.tag}`,
        8500,
      );
      expect(
        await startRefund(db, {
          seasonId: other.seasonId,
          paymentId,
          amount: "",
          reason: null,
          actorId: w.adminId,
        }),
      ).toEqual({ ok: false, error: "unknown_payment" });
    });
  });
});
