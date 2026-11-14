import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { RegistrationId, TeamSeasonId, UserId } from "@/domain/ids";
import { REFERRAL_CREDIT_CENTS } from "@/domain/money/credit";
import type { CheckoutItem } from "@/domain/registration/checkout";
import type { SchedulerInput } from "@/domain/scheduler/types";
import { user } from "../schema/auth";
import { creditEntry, seasonRebate } from "../schema/credit";
import { game, slot } from "../schema/game";
import { savedPaymentMethod } from "../schema/guarantee";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { payment, purchase } from "../schema/money";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { registration, teamSeason } from "../schema/team";
import { waitlistEntry } from "../schema/waitlist";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  creditBalance,
  creditHistory,
  creditOverview,
  grantGoodwill,
} from "./credit";
import {
  chargesToSend,
  planGuarantees,
  recordChargeIntent,
  removeGuarantee,
  teamGuarantee,
} from "./guarantee";
import {
  expirePurchases,
  handleStripeEvent,
  recordOffAppPayment,
  startPurchase,
} from "./payments";
import { issueRebate, rebateBoard } from "./rebates";
import {
  creditReferrals,
  myReferrals,
  recordReferral,
  referralCodeFor,
} from "./referrals";
import {
  registerFreeAgent,
  registerTeam,
  seasonForRegistration,
} from "./registration";
import { required } from "./rows";
import type { Db } from "./schedule";
import { teamBalances } from "./team-balance";
import {
  joinWaitlist,
  leaveWaitlist,
  myWaitlistEntry,
  sendWaitlistOffers,
  waitlistBoard,
} from "./waitlist";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");
const DEADLINE = new Date("2027-03-01T04:59:00Z");
const HOUR = 3_600_000;

/**
 * A per-team season ($1,000 a team, split into shares) with a payment
 * deadline, a team limit, and people ready to register.
 */
async function moneyWorld(db: Db, options: { maxTeams?: number } = {}) {
  const tag = Math.random().toString(36).slice(2, 8);
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "Test League", slug: `money-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  await db.insert(season).values({
    leagueId: lg.id,
    name: "Spring 2027",
    slug: "spring-2027",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    paymentDeadlineAt: DEADLINE,
    feeModel: "per_team",
    teamFeeCents: 100_000,
    freeAgentFeeCents: 8500,
    maxTeams: options.maxTeams ?? null,
    rosterMin: 1,
    rosterMax: 20,
  });
  const s = required(
    await seasonForRegistration(db, lg.id, "spring-2027"),
    "season",
  );
  let n = 0;
  const person = async (
    name: string,
  ): Promise<{ id: UserId; email: string }> => {
    const email = `money-${name}-${++n}-${tag}@example.test`;
    const [u] = await db
      .insert(user)
      .values({ name, email })
      .returning({ id: user.id });
    return { id: required(u, "user").id, email };
  };
  const register = async (userId: UserId, name: string, rosterSize = 4) =>
    registerTeam(db, {
      ageConfirmed: true,
      leagueId: lg.id,
      season: s,
      userId,
      team: {
        teamId: null,
        name,
        colorHex: null,
        paymentMode: "split",
        rosterSize,
      },
      now: NOW,
    });
  return { leagueId: lg.id, season: s, person, register, tag };
}

const shareItem = (
  teamSeasonId: TeamSeasonId,
  registrationId: string,
  cents: number,
): CheckoutItem => ({
  kind: "player_share",
  amountCents: cents,
  description: "Spring 2027 share",
  registrationId,
  teamSeasonId,
});

const keysLike = async (db: Db, prefix: string) =>
  (
    await db
      .select({ key: message.dedupeKey, template: message.template })
      .from(message)
      .where(like(message.dedupeKey, `${prefix}%`))
  ).map((m) => m.key);

describe("league credit at checkout", () => {
  it("takes credit off the total, and gives it back when checkout expires", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db);
      const admin = await w.person("admin");
      const player = await w.person("player");
      const fa = await registerFreeAgent(db, {
        ageConfirmed: true,
        season: w.season,
        userId: player.id,
        now: NOW,
      });
      if (!fa.ok) throw new Error(fa.error);
      const granted = await grantGoodwill(db, {
        email: player.email.toUpperCase(),
        cents: 2000,
        note: "Shirt arrived late",
        actorId: admin.id,
      });
      expect(granted.ok).toBe(true);
      expect(await creditBalance(db, player.id)).toBe(2000);

      const items: CheckoutItem[] = [
        {
          kind: "free_agent_fee",
          amountCents: 8500,
          description: "Spring 2027: free agent",
          registrationId: fa.value,
          teamSeasonId: null,
        },
      ];
      const started = await startPurchase(db, {
        userId: player.id,
        seasonId: w.season.id,
        items,
        promoCode: null,
        now: NOW,
      });
      if (!started.ok) throw new Error(started.error);
      expect(started.value).toMatchObject({
        totalCents: 6500,
        creditCents: 2000,
        chargeCents: [6500],
      });
      expect(await creditBalance(db, player.id)).toBe(0);
      const [row] = await db
        .select()
        .from(purchase)
        .where(eq(purchase.id, started.value.purchaseId));
      expect(row).toMatchObject({
        subtotalCents: 8500,
        creditAppliedCents: 2000,
        totalCents: 6500,
      });

      // Pressing Pay again expires the first checkout and returns its credit.
      await expirePurchases(db, [started.value.purchaseId]);
      await expirePurchases(db, [started.value.purchaseId]);
      expect(await creditBalance(db, player.id)).toBe(2000);
      const history = await creditHistory(db, player.id);
      // One transaction stamps every row with the same time, so sort here.
      expect(history.map((h) => `${h.reason} ${h.deltaCents}`).sort()).toEqual([
        "goodwill 2000",
        "released 2000",
        "spent -2000",
      ]);

      // Unticked: the full price goes to Stripe and the credit stays.
      const without = await startPurchase(db, {
        userId: player.id,
        seasonId: w.season.id,
        items,
        promoCode: null,
        useCredit: false,
        now: NOW,
      });
      expect(without.ok && without.value.totalCents).toBe(8500);
      expect(await creditBalance(db, player.id)).toBe(2000);

      const overview = await creditOverview(db);
      expect(
        overview.holders.find((h) => h.userId === player.id)?.balance,
      ).toBe(2000);
      expect(
        await grantGoodwill(db, {
          email: "nobody@example.test",
          cents: 100,
          note: "x",
          actorId: admin.id,
        }),
      ).toEqual({ ok: false, error: "unknown_player" });
    });
  });

  it("settles a checkout that credit covers, with no payment", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db);
      const admin = await w.person("admin");
      const player = await w.person("player");
      const fa = await registerFreeAgent(db, {
        ageConfirmed: true,
        season: w.season,
        userId: player.id,
        now: NOW,
      });
      if (!fa.ok) throw new Error(fa.error);
      await db
        .update(registration)
        .set({ status: "pending_payment" })
        .where(eq(registration.id, fa.value));
      await grantGoodwill(db, {
        email: player.email,
        cents: 10_000,
        note: "Last season's rain",
        actorId: admin.id,
      });
      const started = await startPurchase(db, {
        userId: player.id,
        seasonId: w.season.id,
        items: [
          {
            kind: "free_agent_fee",
            amountCents: 8500,
            description: "Spring 2027: free agent",
            registrationId: fa.value,
            teamSeasonId: null,
          },
        ],
        promoCode: null,
        now: NOW,
      });
      if (!started.ok) throw new Error(started.error);
      expect(started.value.totalCents).toBe(0);
      expect(await creditBalance(db, player.id)).toBe(1500);
      const [row] = await db
        .select({ status: purchase.status })
        .from(purchase)
        .where(eq(purchase.id, started.value.purchaseId));
      expect(row?.status).toBe("paid");
      const [reg] = await db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, fa.value));
      expect(reg?.status).toBe("active");
      expect(
        await db
          .select()
          .from(payment)
          .where(eq(payment.purchaseId, started.value.purchaseId)),
      ).toEqual([]);
    });
  });
});

describe("split team balance", () => {
  it("confirms a split team once its shares cover the fee", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db);
      const captain = await w.person("captain");
      const team = await w.register(captain.id, "Kick Bottom", 2);
      if (!team.ok) throw new Error(team.error);
      const { teamSeasonId, registrationId, shareCents } = team.value;
      expect(shareCents).toBe(50_000);
      const pay = (regId: RegistrationId, userId: UserId, cents: number) =>
        recordOffAppPayment(db, {
          userId,
          seasonId: w.season.id,
          registrationId: regId,
          items: [shareItem(teamSeasonId, regId, cents)],
          method: "cash",
          note: "",
          actorId: captain.id,
          now: NOW,
        });
      await pay(registrationId, captain.id, 50_000);
      let balance = (await teamBalances(db, [teamSeasonId])).get(teamSeasonId);
      expect(balance).toMatchObject({
        feeCents: 100_000,
        paidCents: 50_000,
        balanceCents: 50_000,
      });
      const status = async () =>
        (
          await db
            .select({ status: teamSeason.status })
            .from(teamSeason)
            .where(eq(teamSeason.id, teamSeasonId))
        )[0]?.status;
      expect(await status()).toBe("forming");
      await pay(registrationId, captain.id, 50_000);
      balance = (await teamBalances(db, [teamSeasonId])).get(teamSeasonId);
      expect(balance?.balanceCents).toBe(0);
      expect(await status()).toBe("confirmed");
    });
  });
});

describe("captain guarantee", () => {
  async function guaranteed(db: Db) {
    const w = await moneyWorld(db);
    const captain = await w.person("captain");
    const team = await w.register(captain.id, "Kick Bottom", 4);
    if (!team.ok) throw new Error(team.error);
    const { teamSeasonId, registrationId } = team.value;
    // The captain pays their own $250 share, leaving $750.
    await recordOffAppPayment(db, {
      userId: captain.id,
      seasonId: w.season.id,
      registrationId,
      items: [shareItem(teamSeasonId, registrationId, 25_000)],
      method: "venmo",
      note: "",
      actorId: captain.id,
      now: NOW,
    });
    const saved = await handleStripeEvent(
      db,
      {
        id: `evt_setup_${w.tag}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: `cs_setup_${w.tag}`,
            mode: "setup",
            metadata: {
              kind: "guarantee",
              userId: captain.id,
              teamSeasonId,
            },
          },
        },
      },
      NOW,
      {
        setup: {
          customerId: "cus_test",
          paymentMethodId: "pm_test",
          brand: "visa",
          last4: "4242",
        },
      },
    );
    expect(saved).toBe("processed");
    return { w, captain, teamSeasonId };
  }

  it("saves a card from a setup session once, and can remove it", async () => {
    await inRolledBackDb(async (db) => {
      const { w, captain, teamSeasonId } = await guaranteed(db);
      expect(await teamGuarantee(db, teamSeasonId)).toMatchObject({
        brand: "visa",
        last4: "4242",
      });
      const replay = await handleStripeEvent(
        db,
        {
          id: `evt_setup_again_${w.tag}`,
          type: "checkout.session.completed",
          data: {
            object: {
              id: `cs_setup_${w.tag}`,
              mode: "setup",
              metadata: { kind: "guarantee", userId: captain.id, teamSeasonId },
            },
          },
        },
        NOW,
        {
          setup: {
            customerId: "cus_test",
            paymentMethodId: "pm_test",
            brand: "visa",
            last4: "4242",
          },
        },
      );
      expect(replay).toBe("ignored");
      // Without the card looked up, the event fails so Stripe retries it.
      await expect(
        handleStripeEvent(
          db,
          {
            id: `evt_setup_nocard_${w.tag}`,
            type: "checkout.session.completed",
            data: {
              object: {
                id: `cs_setup_other_${w.tag}`,
                mode: "setup",
                metadata: {
                  kind: "guarantee",
                  userId: captain.id,
                  teamSeasonId,
                },
              },
            },
          },
          NOW,
        ),
      ).rejects.toThrow();
      expect(
        await removeGuarantee(db, {
          teamSeasonId,
          actorId: captain.id,
          now: NOW,
        }),
      ).toBe(true);
      expect(await teamGuarantee(db, teamSeasonId)).toBeNull();
    });
  });

  it("warns 72 hours ahead, charges the balance once, and settles on the webhook", async () => {
    await inRolledBackDb(async (db) => {
      const { w, captain, teamSeasonId } = await guaranteed(db);
      // A week out: nothing yet.
      expect(
        await planGuarantees(db, new Date(DEADLINE.getTime() - 168 * HOUR)),
      ).toEqual({
        warned: 0,
        charges: 0,
      });
      const warnAt = new Date(DEADLINE.getTime() - 72 * HOUR);
      expect(await planGuarantees(db, warnAt)).toEqual({
        warned: 1,
        charges: 0,
      });
      expect(await planGuarantees(db, warnAt)).toEqual({
        warned: 0,
        charges: 0,
      });
      const [warning] = await db
        .select({ payload: message.payload, userId: message.userId })
        .from(message)
        .where(
          and(
            eq(message.template, "guarantee_warning"),
            eq(message.userId, captain.id),
          ),
        );
      expect(warning?.payload).toMatchObject({
        teamName: "Kick Bottom",
        balance: "$750",
        card: "Visa ending 4242",
      });

      expect(await planGuarantees(db, DEADLINE)).toEqual({
        warned: 0,
        charges: 1,
      });
      expect(await planGuarantees(db, DEADLINE)).toEqual({
        warned: 0,
        charges: 0,
      });
      const due = await chargesToSend(db);
      const charge = required(
        due.find((c) => c.paymentMethodId === "pm_test"),
        "charge",
      );
      expect(charge).toMatchObject({ cents: 75_000, customerId: "cus_test" });
      await recordChargeIntent(db, charge.purchaseId, `pi_${w.tag}`);
      expect(
        (await chargesToSend(db)).some(
          (c) => c.purchaseId === charge.purchaseId,
        ),
      ).toBe(false);

      const succeeded = {
        id: `evt_pi_${w.tag}`,
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: `pi_${w.tag}`,
            amount: 75_000,
            amount_received: 75_000,
            metadata: { purchaseId: charge.purchaseId },
          },
        },
      };
      expect(await handleStripeEvent(db, succeeded, DEADLINE)).toBe(
        "processed",
      );
      expect(await handleStripeEvent(db, succeeded, DEADLINE)).toBe(
        "duplicate",
      );
      const [team] = await db
        .select({ status: teamSeason.status })
        .from(teamSeason)
        .where(eq(teamSeason.id, teamSeasonId));
      expect(team?.status).toBe("confirmed");
      const [paid] = await db
        .select({ amount: payment.amountCents })
        .from(payment)
        .where(eq(payment.purchaseId, charge.purchaseId));
      expect(paid?.amount).toBe(75_000);
      // Checkout's own PaymentIntents are not ours to settle.
      expect(
        await handleStripeEvent(
          db,
          {
            id: `evt_pi_other_${w.tag}`,
            type: "payment_intent.succeeded",
            data: { object: { id: "pi_checkout", amount: 100, metadata: {} } },
          },
          DEADLINE,
        ),
      ).toBe("ignored");
    });
  });

  it("tells the captain when the card is declined", async () => {
    await inRolledBackDb(async (db) => {
      const { w, captain } = await guaranteed(db);
      await planGuarantees(db, new Date(DEADLINE.getTime() - 72 * HOUR));
      await planGuarantees(db, DEADLINE);
      const charge = required((await chargesToSend(db))[0], "charge");
      const outcome = await handleStripeEvent(
        db,
        {
          id: `evt_pi_fail_${w.tag}`,
          type: "payment_intent.payment_failed",
          data: {
            object: {
              id: `pi_fail_${w.tag}`,
              amount: 75_000,
              metadata: { purchaseId: charge.purchaseId },
            },
          },
        },
        DEADLINE,
      );
      expect(outcome).toBe("processed");
      const [row] = await db
        .select({ status: purchase.status })
        .from(purchase)
        .where(eq(purchase.id, charge.purchaseId));
      expect(row?.status).toBe("failed");
      expect(
        await keysLike(db, `guarantee-failed/${charge.purchaseId}`),
      ).toHaveLength(1);
      const [failure] = await db
        .select({ userId: message.userId })
        .from(message)
        .where(eq(message.dedupeKey, `guarantee-failed/${charge.purchaseId}`));
      expect(failure?.userId).toBe(captain.id);
      // A declined charge is not tried again on its own.
      expect(
        await planGuarantees(db, new Date(DEADLINE.getTime() + 24 * HOUR)),
      ).toEqual({
        warned: 0,
        charges: 0,
      });
    });
  });

  it("does nothing for a team that is paid up", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db);
      const captain = await w.person("captain");
      const team = await w.register(captain.id, "Paid Up", 1);
      if (!team.ok) throw new Error(team.error);
      await db.insert(savedPaymentMethod).values({
        userId: captain.id,
        teamSeasonId: team.value.teamSeasonId,
        stripeCustomerId: "cus_x",
        stripePaymentMethodId: "pm_paid_up",
        stripeSetupSessionId: `cs_x_${w.tag}`,
      });
      await recordOffAppPayment(db, {
        userId: captain.id,
        seasonId: w.season.id,
        registrationId: team.value.registrationId,
        items: [
          shareItem(
            team.value.teamSeasonId,
            team.value.registrationId,
            100_000,
          ),
        ],
        method: "cash",
        note: "",
        actorId: captain.id,
        now: NOW,
      });
      await planGuarantees(db, new Date(DEADLINE.getTime() - 72 * HOUR));
      await planGuarantees(db, DEADLINE);
      expect(
        (await chargesToSend(db)).some(
          (c) => c.paymentMethodId === "pm_paid_up",
        ),
      ).toBe(false);
    });
  });
});

describe("waitlist", () => {
  it("offers a freed spot to the next in line and lets nobody jump it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db, { maxTeams: 1 });
      const [first, second, third, late] = await Promise.all([
        w.person("first"),
        w.person("second"),
        w.person("third"),
        w.person("late"),
      ]);
      expect((await w.register(first.id, "Early Birds")).ok).toBe(true);
      expect(await w.register(second.id, "Second Wind")).toEqual({
        ok: false,
        error: "season_full",
      });
      const input = (userId: UserId, teamName: string) => ({
        seasonId: w.season.id,
        maxTeams: 1,
        userId,
        teamName,
        open: true,
      });
      expect(
        await joinWaitlist(db, input(first.id, "Early Birds"), NOW),
      ).toEqual({ ok: false, error: "already_registered" });
      const a = await joinWaitlist(db, input(second.id, " Second  Wind "), NOW);
      expect(a.ok).toBe(true);
      expect((await joinWaitlist(db, input(second.id, "Again"), NOW)).ok).toBe(
        false,
      );
      const later = new Date(NOW.getTime() + 1000);
      expect(
        (await joinWaitlist(db, input(third.id, "Third Base"), later)).ok,
      ).toBe(true);
      expect(
        await myWaitlistEntry(db, w.season.id, third.id, later),
      ).toMatchObject({
        state: "waiting",
        position: 2,
      });

      // Still full: nothing to offer.
      expect(await sendWaitlistOffers(db, later, w.season.id)).toEqual({
        expired: 0,
        offered: 0,
      });

      // The admin raises the limit: the spot goes to the first in line.
      await db
        .update(season)
        .set({ maxTeams: 2 })
        .where(eq(season.id, w.season.id));
      const s2 = { ...w.season, maxTeams: 2 };
      expect(await sendWaitlistOffers(db, later, w.season.id)).toEqual({
        expired: 0,
        offered: 1,
      });
      expect(await keysLike(db, "waitlist-offer/")).toHaveLength(1);
      const offer = await myWaitlistEntry(db, w.season.id, second.id, later);
      expect(offer?.state).toBe("offered");

      // A newcomer cannot take the held spot, nor can the third in line.
      const register = (userId: UserId, name: string, at: Date) =>
        registerTeam(db, {
          ageConfirmed: true,
          leagueId: w.leagueId,
          season: s2,
          userId,
          team: {
            teamId: null,
            name,
            colorHex: null,
            paymentMode: "split",
            rosterSize: 4,
          },
          now: at,
        });
      expect((await register(late.id, "Late Kicks", later)).ok).toBe(false);
      expect((await register(third.id, "Third Base", later)).ok).toBe(false);

      // The offer runs out after 48 hours and passes to the next in line.
      const twoDaysOn = new Date(later.getTime() + 48 * HOUR);
      expect(
        await myWaitlistEntry(db, w.season.id, second.id, twoDaysOn),
      ).toMatchObject({
        state: "expired",
      });
      expect((await register(second.id, "Second Wind", twoDaysOn)).ok).toBe(
        false,
      );
      expect(await sendWaitlistOffers(db, twoDaysOn, w.season.id)).toEqual({
        expired: 1,
        offered: 1,
      });
      const taken = await register(third.id, "Third Base", twoDaysOn);
      expect(taken.ok).toBe(true);
      const board = await waitlistBoard(db, w.season.id, twoDaysOn);
      expect(board.map((b) => [b.teamName, b.status])).toEqual([
        ["Second Wind", "expired"],
        ["Third Base", "accepted"],
      ]);
      expect(
        await leaveWaitlist(
          db,
          { seasonId: w.season.id, userId: third.id },
          twoDaysOn,
        ),
      ).toBe(false);
    });
  });

  it("refuses to queue anyone while a spot is free", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db, { maxTeams: 2 });
      const p = await w.person("p");
      expect(
        await joinWaitlist(
          db,
          {
            seasonId: w.season.id,
            maxTeams: 2,
            userId: p.id,
            teamName: "",
            open: true,
          },
          NOW,
        ),
      ).toEqual({ ok: false, error: "spot_open" });
      expect(
        (
          await db
            .select()
            .from(waitlistEntry)
            .where(eq(waitlistEntry.seasonId, w.season.id))
        ).length,
      ).toBe(0);
    });
  });
});

describe("referrals", () => {
  it("credits the referrer once, when the new player's registration is paid", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db);
      const referrer = await w.person("referrer");
      const friend = await w.person("friend");
      const code = await referralCodeFor(db, referrer.id);
      expect(await referralCodeFor(db, referrer.id)).toBe(code);
      const fa = await registerFreeAgent(db, {
        ageConfirmed: true,
        season: w.season,
        userId: friend.id,
        now: NOW,
      });
      if (!fa.ok) throw new Error(fa.error);
      const input = {
        code,
        referredUserId: friend.id,
        seasonId: w.season.id,
        registrationId: fa.value,
      };
      expect(await recordReferral(db, input)).toBe(true);
      expect(await recordReferral(db, input)).toBe(false);
      expect(
        await recordReferral(db, { ...input, referredUserId: referrer.id }),
      ).toBe(false);
      expect(await myReferrals(db, referrer.id)).toEqual({
        pending: 1,
        credited: 0,
      });

      await recordOffAppPayment(db, {
        userId: friend.id,
        seasonId: w.season.id,
        registrationId: fa.value,
        items: [
          {
            kind: "free_agent_fee",
            amountCents: 8500,
            description: "Spring 2027: free agent",
            registrationId: fa.value,
            teamSeasonId: null,
          },
        ],
        method: "cash",
        note: "",
        actorId: friend.id,
        now: NOW,
      });
      expect(await creditBalance(db, referrer.id)).toBe(REFERRAL_CREDIT_CENTS);
      expect(await creditReferrals(db, [fa.value], NOW)).toBe(0);
      expect(await creditBalance(db, referrer.id)).toBe(REFERRAL_CREDIT_CENTS);
      expect(await myReferrals(db, referrer.id)).toEqual({
        pending: 0,
        credited: 1,
      });
      const [notice] = await db
        .select({ userId: message.userId, template: message.template })
        .from(message)
        .where(like(message.dedupeKey, "referral-credit/%"));
      expect(notice).toEqual({
        userId: referrer.id,
        template: "referral_credit",
      });
    });
  });

  it("only counts a person's first registration", async () => {
    await inRolledBackDb(async (db) => {
      const w = await moneyWorld(db);
      const referrer = await w.person("referrer");
      const regular = await w.person("regular");
      const code = await referralCodeFor(db, referrer.id);
      const first = await registerFreeAgent(db, {
        ageConfirmed: true,
        season: w.season,
        userId: regular.id,
        now: NOW,
      });
      if (!first.ok) throw new Error(first.error);
      const [other] = await db
        .insert(season)
        .values({
          leagueId: w.leagueId,
          name: "Summer 2027",
          slug: "summer-2027",
          status: "registration_open",
          startsOn: "2027-07-05",
          endsOn: "2027-08-28",
          feeModel: "per_player",
          playerFeeCents: 4500,
          rosterMin: 1,
          rosterMax: 20,
        })
        .returning({ id: season.id });
      const [second] = await db
        .insert(registration)
        .values({
          seasonId: required(other, "season").id,
          userId: regular.id,
          kind: "free_agent",
        })
        .returning({ id: registration.id });
      expect(
        await recordReferral(db, {
          code,
          referredUserId: regular.id,
          seasonId: required(other, "season").id,
          registrationId: required(second, "registration").id,
        }),
      ).toBe(false);
    });
  });
});

describe("season rebates", () => {
  it("suggests a pro-rata rebate past the threshold and issues it once, as credit", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = (await w.person("admin")).userId;
      const version = required(
        (
          await db
            .insert(scheduleVersion)
            .values({
              seasonId: w.season.id,
              versionNo: 1,
              status: "published",
              publishedAt: NOW,
              origin: "manual_edit",
              inputSnapshot: {} as SchedulerInput,
            })
            .returning({ id: scheduleVersion.id })
        )[0],
        "version",
      );
      // Four games: played, rained out (slot cancelled), no makeup yet, cancelled.
      const kinds = ["played", "rained", "unplaced", "cancelled"] as const;
      for (const [i, kind] of kinds.entries()) {
        const g = await w.gameEnding(
          new Date(NOW.getTime() + (i + 1) * 7 * 24 * HOUR),
        );
        if (kind === "rained")
          await db
            .update(slot)
            .set({ status: "cancelled" })
            .where(eq(slot.id, g.slotId));
        if (kind === "cancelled")
          await db
            .update(game)
            .set({ status: "cancelled" })
            .where(eq(game.id, g.gameId));
        await db.insert(gamePlacement).values({
          scheduleVersionId: version.id,
          gameId: g.gameId,
          slotId: kind === "unplaced" ? null : g.slotId,
        });
      }
      // Aces: the captain paid $85 and a player $85; the other player nothing.
      const payers = [w.aces.captain, w.aces.players[0]!];
      for (const p of payers)
        await recordOffAppPayment(db, {
          userId: p.userId,
          seasonId: w.season.id,
          registrationId: p.registrationId,
          items: [
            {
              kind: "player_fee",
              amountCents: 8500,
              description: "Fall 2026: Aces",
              registrationId: p.registrationId,
              teamSeasonId: w.aces.id,
            },
          ],
          method: "cash",
          note: "",
          actorId: admin,
          now: NOW,
        });

      const board = await rebateBoard(db, w.season.id);
      expect(board.thresholdPct).toBe(25);
      const aces = required(
        board.rows.find((r) => r.teamSeasonId === w.aces.id),
        "aces",
      );
      expect(aces).toMatchObject({
        gamesCount: 4,
        gamesLost: 3,
        paidCents: 17_000,
        eligible: true,
        rebateCents: 12_750,
        issued: null,
      });
      const bees = board.rows.find((r) => r.teamSeasonId === w.bees.id);
      expect(bees).toMatchObject({
        gamesLost: 3,
        paidCents: 0,
        rebateCents: 0,
      });

      const issue = () =>
        issueRebate(db, {
          seasonId: w.season.id,
          teamSeasonId: w.aces.id,
          actorId: admin,
          now: NOW,
        });
      expect(await issue()).toEqual({
        ok: true,
        value: { rebateCents: 12_750, payers: 2 },
      });
      expect(await issue()).toEqual({ ok: false, error: "already_issued" });
      for (const p of payers)
        expect(await creditBalance(db, p.userId)).toBe(6375);
      expect(
        await issueRebate(db, {
          seasonId: w.season.id,
          teamSeasonId: w.bees.id,
          actorId: admin,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_eligible" });
      const rebates = await db
        .select()
        .from(seasonRebate)
        .where(eq(seasonRebate.teamSeasonId, w.aces.id));
      expect(rebates).toHaveLength(1);
      expect(
        await keysLike(db, `rebate-credit/${rebates[0]?.id}/`),
      ).toHaveLength(2);
      const entries = await db
        .select({ reason: creditEntry.reason })
        .from(creditEntry)
        .where(eq(creditEntry.rebateId, rebates[0]!.id));
      expect(entries.every((e) => e.reason === "rainout_rebate")).toBe(true);
    });
  });
});
