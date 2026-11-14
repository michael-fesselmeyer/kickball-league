import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { checkoutItems } from "@/domain/registration/checkout";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { payment, purchase, webhookEvent } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  attachCheckoutSession,
  createPurchase,
  expirePurchases,
  handleStripeEvent,
  openCheckoutsFor,
  purchaseStatus,
} from "./payments";
import {
  myRegistration,
  registerTeam,
  type SeasonForRegistration,
  seasonForRegistration,
} from "./registration";
import type { Db } from "./schedule";
import { acceptInvite, createTeamInvite } from "./invites";
import { assignWaiver, publishWaiver, signWaiver } from "./waivers";
import { hashWaiverBody } from "@/domain/waiver/waiver";

afterAll(closePool);

const NOW = new Date("2027-02-15T17:00:00Z");

/** A captain paying the full team fee, past the waiver, ready to check out. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [captain] = await db
    .insert(user)
    .values({ name: "Robin", email: `pay-${tag}@example.test` })
    .returning({ id: user.id });
  await db
    .insert(profile)
    .values({ userId: captain!.id, firstName: "Robin", lastName: "Example" });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `pay-${tag}` })
    .returning({ id: league.id });
  await db.insert(season).values({
    leagueId: lg!.id,
    name: "Spring",
    slug: "spring",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: 120_000,
    rosterMin: 1,
    rosterMax: 20,
  });
  const leagueId = lg!.id;
  const s = (await seasonForRegistration(
    db,
    leagueId,
    "spring",
  )) as SeasonForRegistration;
  const userId = captain!.id;
  const team = await registerTeam(db, {
    ageConfirmed: true,
    leagueId,
    season: s,
    userId,
    team: {
      teamId: null,
      name: "Kick Bottom",
      colorHex: null,
      paymentMode: "full",
      rosterSize: 14,
    },
    now: NOW,
  });
  if (!team.ok) throw new Error(team.error);
  const mine = (await myRegistration(db, s.id, userId))!;
  await db
    .update(registration)
    .set({ status: "pending_payment" })
    .where(eq(registration.id, mine.id));
  const ready = (await myRegistration(db, s.id, userId))!;
  const items = checkoutItems(
    s,
    {
      ...ready,
      team: ready.team && {
        ...ready.team,
        teamSeasonId: ready.team.teamSeasonId,
      },
    },
    NOW,
  );
  if (!items.ok) throw new Error(items.error);
  const purchaseId = await createPurchase(db, {
    userId,
    seasonId: s.id,
    items: items.items,
  });
  await attachCheckoutSession(db, purchaseId, `cs_test_${tag}`);
  return {
    sessionId: `cs_test_${tag}`,
    purchaseId,
    registrationId: mine.id,
    teamSeasonId: team.value.teamSeasonId,
    captain: userId,
    tag,
  };
}

const event = (id: string, type: string, object: Record<string, unknown>) => ({
  id,
  type,
  data: { object },
});

describe("payments", () => {
  it("marks a purchase paid only from the webhook, once, and activates the registration and team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await purchaseStatus(db, w.purchaseId)).toMatchObject({
        status: "open",
      });
      expect(await openCheckoutsFor(db, w.registrationId)).toEqual([
        { id: w.purchaseId, sessionId: w.sessionId },
      ]);
      const completed = event(`evt_${w.tag}`, "checkout.session.completed", {
        id: w.sessionId,
        payment_status: "paid",
        payment_intent: `pi_${w.tag}`,
        amount_total: 120_000,
      });
      expect(await handleStripeEvent(db, completed, NOW)).toBe("processed");
      // Stripe retries: the same event again changes nothing.
      expect(await handleStripeEvent(db, completed, NOW)).toBe("duplicate");

      expect(await purchaseStatus(db, w.purchaseId)).toMatchObject({
        status: "paid",
      });
      const payments = await db
        .select({ amount: payment.amountCents })
        .from(payment)
        .where(eq(payment.purchaseId, w.purchaseId));
      expect(payments).toEqual([{ amount: 120_000 }]);
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
      const [row] = await db
        .select({ status: webhookEvent.status })
        .from(webhookEvent)
        .where(eq(webhookEvent.eventId, `evt_${w.tag}`));
      expect(row?.status).toBe("processed");
    });
  });

  it("leaves an unpaid completion open, and records failures and expiries", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // A bank payment that has not cleared yet completes with "unpaid".
      await handleStripeEvent(
        db,
        event(`evt_a_${w.tag}`, "checkout.session.completed", {
          id: w.sessionId,
          payment_status: "unpaid",
        }),
        NOW,
      );
      expect(await purchaseStatus(db, w.purchaseId)).toMatchObject({
        status: "open",
      });
      await handleStripeEvent(
        db,
        event(`evt_b_${w.tag}`, "checkout.session.async_payment_failed", {
          id: w.sessionId,
        }),
        NOW,
      );
      expect(await purchaseStatus(db, w.purchaseId)).toMatchObject({
        status: "failed",
      });
      // A later expiry does not overwrite the failure.
      await handleStripeEvent(
        db,
        event(`evt_c_${w.tag}`, "checkout.session.expired", {
          id: w.sessionId,
        }),
        NOW,
      );
      expect(await purchaseStatus(db, w.purchaseId)).toMatchObject({
        status: "failed",
      });
    });
  });

  it("ignores events for other sessions or types, and expires stale checkouts", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await handleStripeEvent(
          db,
          event(`evt_x_${w.tag}`, "checkout.session.completed", {
            id: "cs_other",
            payment_status: "paid",
          }),
          NOW,
        ),
      ).toBe("ignored");
      expect(
        await handleStripeEvent(
          db,
          event(`evt_y_${w.tag}`, "customer.created", { id: "cus_1" }),
          NOW,
        ),
      ).toBe("ignored");
      await expirePurchases(db, [w.purchaseId]);
      expect(await purchaseStatus(db, w.purchaseId)).toMatchObject({
        status: "expired",
      });
      expect(await openCheckoutsFor(db, w.registrationId)).toEqual([]);
      await expirePurchases(db, []);
      const all = await db
        .select({ status: purchase.status })
        .from(purchase)
        .where(eq(purchase.id, w.purchaseId));
      expect(all).toEqual([{ status: "expired" }]);
    });
  });

  it("counts teammates as paid once the captain pays the whole fee, even if they join later", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [lg] = await db
        .select({ leagueId: season.leagueId, id: season.id })
        .from(season)
        .innerJoin(teamSeason, eq(teamSeason.seasonId, season.id))
        .where(eq(teamSeason.id, w.teamSeasonId));
      const body = `# Sample\n\n${"Sample text for tests only. ".repeat(10)}`;
      const v = await publishWaiver(
        db,
        { leagueId: lg!.leagueId, title: "Release", body },
        w.captain,
      );
      if (!v.ok) throw new Error();
      await assignWaiver(
        db,
        { leagueId: lg!.leagueId, seasonId: lg!.id, waiverId: v.value.id },
        w.captain,
      );
      const people = await db
        .insert(user)
        .values(
          ["Sam", "Alex"].map((n) => ({
            name: n,
            email: `pay-${n}-${w.tag}@example.test`,
          })),
        )
        .returning({ id: user.id });
      await db.insert(profile).values(
        people.map((p, i) => ({
          userId: p.id,
          firstName: ["Sam", "Alex"][i],
          lastName: "Example",
        })),
      );
      const [sam, alex] = people.map((p) => p.id) as [UserId, UserId];
      const link = await createTeamInvite(db, {
        teamSeasonId: w.teamSeasonId,
        actorId: sam,
        now: NOW,
      });
      const sign = (userId: UserId, name: string) =>
        signWaiver(db, {
          ageConfirmed: true,
          userId,
          seasonId: lg!.id,
          shownSha256: hashWaiverBody(body),
          agreed: true,
          signedName: name,
          ip: null,
          userAgent: null,
        });
      const statusOf = async (userId: UserId) =>
        (
          await db
            .select({ status: registration.status })
            .from(registration)
            .where(eq(registration.userId, userId))
        )[0]?.status;

      // Sam joins and signs before the captain pays.
      await acceptInvite(db, {
        ageConfirmed: true,
        token: link.token,
        userId: sam,
        now: NOW,
      });
      await sign(sam, "Sam Example");
      expect(await statusOf(sam)).toBe("pending_payment");
      await handleStripeEvent(
        db,
        event(`evt_full_${w.tag}`, "checkout.session.completed", {
          id: w.sessionId,
          payment_status: "paid",
          payment_intent: `pi_full_${w.tag}`,
          amount_total: 120_000,
        }),
        NOW,
      );
      expect(await statusOf(sam)).toBe("active");

      // Alex joins after: signing the waiver is the last step.
      await acceptInvite(db, {
        ageConfirmed: true,
        token: link.token,
        userId: alex,
        now: NOW,
      });
      expect(await statusOf(alex)).toBe("pending_waiver");
      await sign(alex, "Alex Example");
      expect(await statusOf(alex)).toBe("active");
    });
  });
});
