import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { PurchaseId } from "@/domain/ids";
import {
  bankFeeCents,
  cardFeeCents,
  DEFAULT_FEE_SETTINGS,
  type FeeSettings,
  feeShareOfRefund,
  venmoFeeCents,
} from "@/domain/money/processing-fee";
import { feeChoice } from "@/lib/checkout-fees";
import { user } from "../schema/auth";
import { creditEntry } from "../schema/credit";
import { savedPaymentMethod } from "../schema/guarantee";
import { league } from "../schema/league";
import { payment, promoCode, purchase } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { creditBalance } from "./credit";
import { planGuarantees } from "./guarantee";
import {
  attachCheckoutSession,
  handleStripeEvent,
  openCheckoutsFor,
  processingPaymentFor,
  type PurchaseLine,
  recordOffAppPayment,
  startPurchase,
} from "./payments";
import { feeSettingsOf, saveFeeSettings } from "./processing-fees";
import { rebateBoard } from "./rebates";
import {
  myRegistration,
  registerTeam,
  type SeasonForRegistration,
  seasonForRegistration,
} from "./registration";
import type { Db } from "./schedule";
import { teamBalances } from "./team-balance";

/**
 * Payers cover processing fees (ADR 0082): every money path with the
 * league's setting off and on.
 */

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");
const FEE = 120_000;

const ON: FeeSettings = {
  ...DEFAULT_FEE_SETTINGS,
  mode: "non_card_discount",
  bankTransfers: true,
};

/** A league with one per-team season and a captain whose team is in it. */
async function world(
  db: Db,
  options: { split?: boolean; deadline?: Date } = {},
) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [captain] = await db
    .insert(user)
    .values({ name: "Robin", email: `fees-${tag}@example.test` })
    .returning({ id: user.id });
  const userId = captain!.id;
  await db
    .insert(profile)
    .values({ userId, firstName: "Robin", lastName: "Example" });
  const [lg] = await db
    .insert(league)
    .values({ name: "Fee League", slug: `fees-${tag}` })
    .returning({ id: league.id });
  const leagueId = lg!.id;
  await db.insert(season).values({
    leagueId,
    name: "Spring",
    slug: "spring",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: FEE,
    rosterMin: 1,
    rosterMax: 20,
    paymentDeadlineAt: options.deadline ?? null,
  });
  const s = (await seasonForRegistration(
    db,
    leagueId,
    "spring",
  )) as SeasonForRegistration;
  const team = await registerTeam(db, {
    ageConfirmed: true,
    leagueId,
    season: s,
    userId,
    team: {
      teamId: null,
      name: "Fee Kickers",
      colorHex: null,
      paymentMode: options.split ? "split" : "full",
      rosterSize: 12,
    },
    now: NOW,
  });
  if (!team.ok) throw new Error(team.error);
  const mine = (await myRegistration(db, s.id, userId))!;
  await db
    .update(registration)
    .set({ status: "pending_payment" })
    .where(eq(registration.id, mine.id));
  const teamSeasonId = team.value.teamSeasonId;
  const line = (cents: number): PurchaseLine => ({
    kind: options.split ? "player_share" : "team_fee",
    amountCents: cents,
    description: "Spring: Fee Kickers",
    registrationId: mine.id,
    teamSeasonId,
  });
  return {
    tag,
    userId,
    leagueId,
    seasonId: s.id,
    registrationId: mine.id,
    teamSeasonId,
    line,
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function turnOn(db: Db, w: World, settings: FeeSettings = ON) {
  await saveFeeSettings(db, {
    leagueId: w.leagueId,
    actorId: w.userId,
    settings,
  });
}

/** Starts a checkout the way the season page does, and gives it a session. */
async function checkout(
  db: Db,
  w: World,
  input: {
    cents?: number;
    method?: "card" | "bank";
    promoCode?: string;
    useCredit?: boolean;
  } = {},
) {
  const settings = await feeSettingsOf(db, w.leagueId);
  const started = await startPurchase(db, {
    userId: w.userId,
    leagueId: w.leagueId,
    seasonId: w.seasonId,
    items: [w.line(input.cents ?? FEE)],
    promoCode: input.promoCode ?? null,
    useCredit: input.useCredit ?? false,
    fee: feeChoice(input.method ?? "card", settings, { bank: true }),
    now: NOW,
  });
  if (!started.ok) throw new Error(started.error);
  const sessionId = `cs_fee_${w.tag}_${Math.random().toString(36).slice(2, 6)}`;
  await attachCheckoutSession(db, started.value.purchaseId, sessionId);
  return { ...started.value, sessionId };
}

const event = (id: string, type: string, object: Record<string, unknown>) => ({
  id,
  type,
  data: { object },
});

let seq = 0;
const eventId = () => `evt_fee_${Date.now()}_${(seq += 1)}`;

async function complete(
  db: Db,
  c: { sessionId: string; totalCents: number },
  intent: string,
  status: "paid" | "unpaid" = "paid",
) {
  return handleStripeEvent(
    db,
    event(eventId(), "checkout.session.completed", {
      id: c.sessionId,
      payment_status: status,
      payment_intent: intent,
      amount_total: c.totalCents,
    }),
    NOW,
  );
}

async function refundTo(db: Db, intent: string, amountRefunded: number) {
  return handleStripeEvent(
    db,
    event(eventId(), "charge.refunded", {
      id: `ch_${intent}`,
      object: "charge",
      payment_intent: intent,
      amount_refunded: amountRefunded,
    }),
    NOW,
  );
}

async function purchaseRow(db: Db, id: PurchaseId) {
  const [row] = await db.select().from(purchase).where(eq(purchase.id, id));
  return row!;
}

async function paymentOf(db: Db, id: PurchaseId) {
  const [row] = await db
    .select()
    .from(payment)
    .where(eq(payment.purchaseId, id));
  return row;
}

async function giveCredit(db: Db, w: World, cents: number) {
  await db.insert(creditEntry).values({
    userId: w.userId,
    leagueId: w.leagueId,
    deltaCents: cents,
    reason: "goodwill",
    note: "Test credit",
    issuedBy: w.userId,
  });
}

describe("processing fees while the setting is off", () => {
  it("is off for a new league and changes no amount", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const settings = await feeSettingsOf(db, w.leagueId);
      expect(settings).toEqual(DEFAULT_FEE_SETTINGS);
      expect(feeChoice("card", settings, { bank: true })).toBeNull();
      expect(feeChoice("bank", settings, { bank: true })).toBeNull();
      const c = await checkout(db, w);
      expect(c).toMatchObject({
        totalCents: FEE,
        feeCents: 0,
        feeMethod: null,
        chargeCents: [FEE],
      });
      const row = await purchaseRow(db, c.purchaseId);
      expect(row).toMatchObject({
        subtotalCents: FEE,
        totalCents: FEE,
        feeCents: 0,
        feeMethod: null,
        feeSavedCents: 0,
      });
      await complete(db, c, `pi_off_${w.tag}`);
      expect((await paymentOf(db, c.purchaseId))?.amountCents).toBe(FEE);
    });
  });

  it("records cash, Zelle and check at the price, saving nothing", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const method of ["zelle", "check"] as const) {
        const id = await recordOffAppPayment(db, {
          userId: w.userId,
          seasonId: w.seasonId,
          registrationId: w.registrationId,
          items: [w.line(FEE)],
          method,
          note: "",
          actorId: w.userId,
          now: NOW,
        });
        const row = await purchaseRow(db, id);
        expect(row).toMatchObject({
          status: "paid",
          totalCents: FEE,
          feeCents: 0,
          feeSavedCents: 0,
        });
        expect(await paymentOf(db, id)).toMatchObject({
          method,
          amountCents: FEE,
        });
      }
    });
  });
});

describe("processing fees while the setting is on", () => {
  it("has the card payer cover the fee so the league nets its price", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await turnOn(db, w);
      const c = await checkout(db, w);
      const fee = cardFeeCents(FEE, ON);
      expect(fee).toBeGreaterThan(0);
      // The fee is its own line: the item is charged at its price.
      expect(c).toMatchObject({
        totalCents: FEE + fee,
        feeCents: fee,
        feeMethod: "card",
        chargeCents: [FEE],
      });
      expect(await purchaseRow(db, c.purchaseId)).toMatchObject({
        subtotalCents: FEE,
        feeCents: fee,
        feeMethod: "card",
        totalCents: FEE + fee,
      });
      await complete(db, c, `pi_card_${w.tag}`);
      expect(await purchaseRow(db, c.purchaseId)).toMatchObject({
        status: "paid",
      });
      expect((await paymentOf(db, c.purchaseId))?.amountCents).toBe(FEE + fee);
      const [reg] = await db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, w.registrationId));
      expect(reg?.status).toBe("active");
      const [entry] = await db
        .select({ status: teamSeason.status })
        .from(teamSeason)
        .where(eq(teamSeason.id, w.teamSeasonId));
      expect(entry?.status).toBe("confirmed");
    });
  });

  it("works the fee out on what is left after a promo code and credit", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await turnOn(db, w);
      await db.insert(promoCode).values({
        seasonId: w.seasonId,
        code: "TENOFF",
        kind: "percent",
        value: 10,
      });
      await giveCredit(db, w, 8_000);
      const c = await checkout(db, w, {
        promoCode: "tenoff",
        useCredit: true,
      });
      const net = FEE - 12_000 - 8_000;
      const fee = cardFeeCents(net, ON);
      expect(c).toMatchObject({
        creditCents: 8_000,
        feeCents: fee,
        totalCents: net + fee,
      });
      expect(c.chargeCents.reduce((a, b) => a + b, 0)).toBe(net);
      expect(await purchaseRow(db, c.purchaseId)).toMatchObject({
        discountCents: 12_000,
        creditAppliedCents: 8_000,
        feeCents: fee,
        totalCents: net + fee,
      });
    });
  });

  it("charges no fee when credit covers the whole price", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await turnOn(db, w);
      await giveCredit(db, w, FEE + 5_000);
      const c = await checkout(db, w, { useCredit: true });
      expect(c).toMatchObject({ totalCents: 0, feeCents: 0, feeMethod: null });
      expect(await purchaseRow(db, c.purchaseId)).toMatchObject({
        status: "paid",
        feeCents: 0,
        feeMethod: null,
      });
      expect(await creditBalance(db, w.userId, w.leagueId)).toBe(5_000);
    });
  });

  it("counts only a split share's price toward the team fee", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, { split: true });
      await turnOn(db, w);
      const c = await checkout(db, w, { cents: 10_000 });
      expect(c.feeCents).toBe(cardFeeCents(10_000, ON));
      await complete(db, c, `pi_share_${w.tag}`);
      const balance = (await teamBalances(db, [w.teamSeasonId])).get(
        w.teamSeasonId,
      );
      expect(balance).toMatchObject({
        paidCents: 10_000,
        balanceCents: FEE - 10_000,
      });
    });
  });

  it("refunds the fee with the price, in full or in proportion, even out of order", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await turnOn(db, w);
      const c = await checkout(db, w);
      const total = c.totalCents;
      const intent = `pi_refund_${w.tag}`;
      // Stripe reports half the charge refunded before the payment itself.
      const half = Math.floor(total / 2);
      expect(await refundTo(db, intent, half)).toBe("ignored");
      await complete(db, c, intent);
      expect(await paymentOf(db, c.purchaseId)).toMatchObject({
        amountCents: total,
        refundedCents: half,
      });
      expect((await purchaseRow(db, c.purchaseId)).status).toBe(
        "partially_refunded",
      );
      // A rain-out rebate counts what was paid for the team, never the fee:
      // the refund's share of the fee does not come off the price.
      const board = await rebateBoard(db, w.seasonId, w.teamSeasonId);
      const refundedPrice = half - feeShareOfRefund(half, total, c.feeCents);
      expect(board.rows[0]?.paidCents).toBe(FEE - refundedPrice);
      // Then the rest: the whole charge, fee included, goes back.
      expect(await refundTo(db, intent, total)).toBe("processed");
      expect(await paymentOf(db, c.purchaseId)).toMatchObject({
        refundedCents: total,
      });
      expect((await purchaseRow(db, c.purchaseId)).status).toBe("refunded");
      const after = await rebateBoard(db, w.seasonId, w.teamSeasonId);
      expect(after.rows[0]?.paidCents ?? 0).toBe(0);
    });
  });

  it("gives credit back and records nothing paid when a checkout fails or expires", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await turnOn(db, w);
      await giveCredit(db, w, 5_000);
      const c = await checkout(db, w, { method: "bank", useCredit: true });
      expect(c.feeMethod).toBe("bank");
      expect(c.feeCents).toBe(bankFeeCents(FEE - 5_000, ON));
      expect(await creditBalance(db, w.userId, w.leagueId)).toBe(0);
      await complete(db, c, `pi_fail_${w.tag}`, "unpaid");
      await handleStripeEvent(
        db,
        event(eventId(), "checkout.session.async_payment_failed", {
          id: c.sessionId,
        }),
        NOW,
      );
      expect((await purchaseRow(db, c.purchaseId)).status).toBe("failed");
      expect(await paymentOf(db, c.purchaseId)).toBeUndefined();
      expect(await creditBalance(db, w.userId, w.leagueId)).toBe(5_000);
    });
  });

  it("keeps a bank transfer on its way from being paid twice, then settles it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await turnOn(db, w);
      const c = await checkout(db, w, { method: "bank" });
      const fee = bankFeeCents(FEE, ON);
      expect(c).toMatchObject({ feeMethod: "bank", feeCents: fee });
      expect(fee).toBe(500); // Stripe's cap
      expect(await openCheckoutsFor(db, w.registrationId)).toHaveLength(1);
      await complete(db, c, `pi_bank_${w.tag}`, "unpaid");
      // On its way: not offered for expiry by a second "Pay", and shown.
      expect(await openCheckoutsFor(db, w.registrationId)).toEqual([]);
      expect(await processingPaymentFor(db, w.registrationId)).toMatchObject({
        id: c.purchaseId,
      });
      await handleStripeEvent(
        db,
        event(eventId(), "checkout.session.async_payment_succeeded", {
          id: c.sessionId,
          payment_status: "paid",
          payment_intent: `pi_bank_${w.tag}`,
          amount_total: c.totalCents,
        }),
        NOW,
      );
      expect((await purchaseRow(db, c.purchaseId)).status).toBe("paid");
      expect((await paymentOf(db, c.purchaseId))?.amountCents).toBe(FEE + fee);
      expect(await processingPaymentFor(db, w.registrationId)).toBeNull();
    });
  });

  it("offers no bank transfer unless the league turned them on", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await turnOn(db, w, { ...ON, bankTransfers: false });
      const c = await checkout(db, w, { method: "bank" });
      expect(c).toMatchObject({
        feeMethod: "card",
        feeCents: cardFeeCents(FEE, ON),
      });
    });
  });

  it("charges the guarantee at the card price, after a bank transfer on its way clears or fails", async () => {
    await inRolledBackDb(async (db) => {
      const deadline = new Date(NOW.getTime() - 3_600_000);
      const w = await world(db, { split: true, deadline });
      await turnOn(db, w);
      await db.insert(savedPaymentMethod).values({
        userId: w.userId,
        teamSeasonId: w.teamSeasonId,
        stripeCustomerId: `cus_${w.tag}`,
        stripePaymentMethodId: `pm_${w.tag}`,
        stripeSetupSessionId: `cs_setup_${w.tag}`,
        brand: "visa",
        last4: "4242",
        warnedForDeadline: deadline,
        warnedAt: new Date(deadline.getTime() - 4 * 86_400_000),
      });
      const chargeOf = async () =>
        (
          await db
            .select({ id: savedPaymentMethod.chargePurchaseId })
            .from(savedPaymentMethod)
            .where(eq(savedPaymentMethod.teamSeasonId, w.teamSeasonId))
        )[0]?.id ?? null;

      // A teammate's share is on its way by bank transfer: wait.
      const share = await checkout(db, w, { cents: 10_000, method: "bank" });
      await complete(db, share, `pi_wait_${w.tag}`, "unpaid");
      await planGuarantees(db, NOW);
      expect(await chargeOf()).toBeNull();

      // It failed: now the card is charged for the balance at the card price.
      await handleStripeEvent(
        db,
        event(eventId(), "checkout.session.async_payment_failed", {
          id: share.sessionId,
        }),
        NOW,
      );
      await planGuarantees(db, NOW);
      const chargeId = await chargeOf();
      expect(chargeId).not.toBeNull();
      const fee = cardFeeCents(FEE, ON);
      expect(await purchaseRow(db, chargeId as PurchaseId)).toMatchObject({
        subtotalCents: FEE,
        feeCents: fee,
        feeMethod: "card",
        totalCents: FEE + fee,
      });
      // Settled by its PaymentIntent: the team counts the price only.
      await db
        .update(purchase)
        .set({ stripePaymentIntentId: `pi_guarantee_${w.tag}` })
        .where(eq(purchase.id, chargeId as PurchaseId));
      await handleStripeEvent(
        db,
        event(eventId(), "payment_intent.succeeded", {
          id: `pi_guarantee_${w.tag}`,
          amount: FEE + fee,
          amount_received: FEE + fee,
        }),
        NOW,
      );
      const balance = (await teamBalances(db, [w.teamSeasonId])).get(
        w.teamSeasonId,
      );
      expect(balance).toMatchObject({ paidCents: FEE, balanceCents: 0 });
    });
  });

  it("charges the guarantee at the price while the setting is off", async () => {
    await inRolledBackDb(async (db) => {
      const deadline = new Date(NOW.getTime() - 3_600_000);
      const w = await world(db, { split: true, deadline });
      await db.insert(savedPaymentMethod).values({
        userId: w.userId,
        teamSeasonId: w.teamSeasonId,
        stripeCustomerId: `cus_${w.tag}`,
        stripePaymentMethodId: `pm_${w.tag}`,
        stripeSetupSessionId: `cs_setup_${w.tag}`,
        warnedForDeadline: deadline,
        warnedAt: new Date(deadline.getTime() - 4 * 86_400_000),
      });
      await planGuarantees(db, NOW);
      const [saved] = await db
        .select({ id: savedPaymentMethod.chargePurchaseId })
        .from(savedPaymentMethod)
        .where(eq(savedPaymentMethod.teamSeasonId, w.teamSeasonId));
      expect(await purchaseRow(db, saved!.id as PurchaseId)).toMatchObject({
        totalCents: FEE,
        feeCents: 0,
        feeMethod: null,
      });
    });
  });

  it("has a Venmo business payer cover Venmo's fee, and records what free methods saved", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const settings = { ...ON, venmoBusiness: true };
      await turnOn(db, w, settings);
      const venmo = await recordOffAppPayment(db, {
        userId: w.userId,
        seasonId: w.seasonId,
        registrationId: w.registrationId,
        items: [w.line(10_000)],
        method: "venmo",
        note: "",
        actorId: w.userId,
        now: NOW,
      });
      const vFee = venmoFeeCents(10_000, settings);
      expect(await purchaseRow(db, venmo)).toMatchObject({
        totalCents: 10_000 + vFee,
        feeCents: vFee,
        feeMethod: "venmo",
        feeSavedCents: cardFeeCents(10_000, settings) - vFee,
      });
      expect((await paymentOf(db, venmo))?.amountCents).toBe(10_000 + vFee);

      const cash = await recordOffAppPayment(db, {
        userId: w.userId,
        seasonId: w.seasonId,
        registrationId: w.registrationId,
        items: [w.line(10_000)],
        method: "cash",
        note: "",
        actorId: w.userId,
        now: NOW,
      });
      expect(await purchaseRow(db, cash)).toMatchObject({
        totalCents: 10_000,
        feeCents: 0,
        feeSavedCents: cardFeeCents(10_000, settings),
      });
    });
  });

  it("refuses a purchase whose total leaves out its fee", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await expect(
        db.insert(purchase).values({
          userId: w.userId,
          leagueId: w.leagueId,
          seasonId: w.seasonId,
          subtotalCents: 1_000,
          feeCents: 59,
          feeMethod: "card",
          totalCents: 1_000,
        }),
      ).rejects.toThrow();
    });
  });
});
