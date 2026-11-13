import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import {
  buildMoneySummary,
  publishBlocker,
  seasonFees,
  seasonMoney,
} from "@/domain/dashboard/money";
import { buildDashboardView } from "@/domain/dashboard/view";
import type { SeasonId, UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { event, eventRsvp, eventTicket } from "../schema/event";
import { payment, purchase, purchaseItem } from "../schema/money";
import { moneySummary } from "../schema/money-summary";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { checkin, sponsor } from "../schema/sponsor";
import { registration } from "../schema/team";
import { leagueWorld, NOW } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { addExpense } from "./books";
import {
  dashboardSeasons,
  ownerDashboard,
  publicSummary,
  publishedSummarySeasons,
  publishSummary,
  summaryInputs,
  unpublishSummary,
} from "./owner-dashboard";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

const SPRING = { startsOn: "2027-04-05", endsOn: "2027-06-28" };

/**
 * The export world's spring season, plus a completed fall season before it
 * (the captain and two people who did not come back), a draft season after
 * it, money in and out, two events and sponsor check-ins.
 */
async function dashboardWorld(db: Db) {
  const w = await leagueWorld(db);
  const tag = Math.random().toString(36).slice(2, 8);
  // Slugs of their own, so a seeded league in the same database never matches.
  const slugs = {
    spring: `spring-2027-${tag}`,
    fall: `fall-2026-${tag}`,
    draft: `fall-2027-${tag}`,
  };
  await db
    .update(season)
    .set({ slug: slugs.spring })
    .where(eq(season.id, w.season.id));
  const extra = await db
    .insert(user)
    .values(
      ["Quinn Former", "Riley Former"].map((name, i) => ({
        name,
        email: `dash-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [fall, draft] = await db
    .insert(season)
    .values([
      {
        leagueId: w.leagueId,
        name: "Fall 2026",
        slug: slugs.fall,
        status: "completed" as const,
        startsOn: "2026-09-01",
        endsOn: "2026-11-01",
        feeModel: "per_player" as const,
        playerFeeCents: 4000,
        rosterMin: 1,
        rosterMax: 20,
      },
      {
        leagueId: w.leagueId,
        name: "Fall 2027",
        slug: slugs.draft,
        status: "draft" as const,
        startsOn: "2027-09-01",
        endsOn: "2027-11-01",
        feeModel: "per_player" as const,
        playerFeeCents: 4000,
        rosterMin: 1,
        rosterMax: 20,
      },
    ])
    .returning({ id: season.id });
  if (!fall || !draft) throw new Error("no seasons");
  await db.insert(registration).values([
    ...[w.captain, ...extra.map((u) => u.id)].map((userId) => ({
      seasonId: fall.id,
      userId,
      kind: "team_member" as const,
      status: "active" as const,
    })),
    // Cancelled: never a member.
    {
      seasonId: fall.id,
      userId: w.otherCaptain,
      kind: "free_agent" as const,
      status: "cancelled" as const,
    },
    // A draft season's sign-ups are not counted anywhere.
    {
      seasonId: draft.id,
      userId: w.teammate,
      kind: "free_agent" as const,
      status: "active" as const,
    },
  ]);

  // An event ticket paid in the app during spring, partly refunded: it has
  // no season, so it counts by the day it was paid.
  const [ticketBuy] = await db
    .insert(purchase)
    .values({
      userId: w.agent,
      seasonId: null,
      status: "paid",
      subtotalCents: 1500,
      totalCents: 1500,
    })
    .returning({ id: purchase.id });
  if (!ticketBuy) throw new Error("no purchase");
  await db.insert(purchaseItem).values({
    purchaseId: ticketBuy.id,
    kind: "event_ticket",
    amountCents: 1500,
    description: "Bowling night",
  });
  await db.insert(payment).values({
    purchaseId: ticketBuy.id,
    method: "stripe",
    stripePaymentIntentId: `pi_dash_${tag}`,
    amountCents: 1500,
    refundedCents: 500,
    status: "succeeded",
    paidAt: new Date("2027-05-01T20:00:00Z"),
  });
  // A failed payment counts for nothing.
  const [failed] = await db
    .insert(purchase)
    .values({
      userId: w.captain,
      seasonId: w.season.id,
      status: "failed",
      subtotalCents: 4500,
      totalCents: 4500,
    })
    .returning({ id: purchase.id });
  if (!failed) throw new Error("no purchase");
  await db.insert(payment).values({
    purchaseId: failed.id,
    method: "stripe",
    stripePaymentIntentId: `pi_dash_failed_${tag}`,
    amountCents: 4500,
    status: "failed",
  });

  const added = await addExpense(
    db,
    {
      leagueId: w.leagueId,
      seasonId: w.season.id,
      spentOn: "2027-04-01",
      amountCents: 3000,
      category: "refs",
      note: "Opening day ref",
      receipt: null,
    },
    w.captain,
  );
  if (!added.ok) throw new Error(added.error);

  // Events: a ticketed one with one of two checked in, a free one, a theme
  // week and a called-off event (both left out), and one after the season.
  const at = (day: string) => ({
    startsAt: new Date(`${day}T23:00:00Z`),
    endsAt: new Date(`${day}T23:59:00Z`),
  });
  const events = await db
    .insert(event)
    .values([
      {
        leagueId: w.leagueId,
        title: "Bowling night",
        slug: `bowling-${tag}`,
        ticketPriceCents: 1500,
        ...at("2027-05-08"),
      },
      {
        leagueId: w.leagueId,
        title: "Park picnic",
        slug: `picnic-${tag}`,
        ...at("2027-04-20"),
      },
      {
        leagueId: w.leagueId,
        kind: "theme_week" as const,
        title: "Neon week",
        slug: `neon-${tag}`,
        ...at("2027-05-15"),
      },
      {
        leagueId: w.leagueId,
        title: "Rained-out mixer",
        slug: `mixer-${tag}`,
        cancelledAt: NOW,
        ...at("2027-05-20"),
      },
      {
        leagueId: w.leagueId,
        title: "Summer party",
        slug: `summer-${tag}`,
        ...at("2027-07-20"),
      },
    ])
    .returning({ id: event.id, title: event.title });
  const id = (title: string) => {
    const found = events.find((e) => e.title === title);
    if (!found) throw new Error(`no event ${title}`);
    return found.id;
  };
  await db.insert(eventRsvp).values([
    { eventId: id("Bowling night"), userId: w.agent, status: "going" },
    { eventId: id("Bowling night"), userId: w.captain, status: "going" },
    { eventId: id("Park picnic"), userId: w.captain, status: "going" },
    { eventId: id("Park picnic"), userId: w.teammate, status: "waitlisted" },
  ]);
  await db.insert(eventTicket).values([
    {
      eventId: id("Bowling night"),
      userId: w.agent,
      purchaseId: ticketBuy.id,
      status: "paid",
      priceCents: 1500,
      code: "ABCDEF",
      checkedInAt: new Date("2027-05-08T23:30:00Z"),
    },
  ]);

  const bars = await db
    .insert(sponsor)
    .values(
      ["Dugout Tavern", "The Corner Pocket"].map((name, i) => ({
        leagueId: w.leagueId,
        name,
        slug: `bar-${i}-${tag}`,
        checkinSecret: `test-checkin-placeholder-${i}-${tag}`.padEnd(32, "x"),
      })),
    )
    .returning({ id: sponsor.id });
  const [dugout, corner] = bars;
  if (!dugout || !corner) throw new Error("no sponsors");
  await db.insert(checkin).values([
    // Monday April 12 and the Saturday after: one week.
    { sponsorId: dugout.id, userId: w.captain, onDate: "2027-04-12" },
    { sponsorId: dugout.id, userId: w.teammate, onDate: "2027-04-17" },
    { sponsorId: corner.id, userId: w.agent, onDate: "2027-04-17" },
    // The next week, and one before the season (left out).
    { sponsorId: corner.id, userId: w.captain, onDate: "2027-04-19" },
    { sponsorId: corner.id, userId: w.teammate, onDate: "2027-03-01" },
  ]);

  return { ...w, slugs, fallId: fall.id, draftId: draft.id, events };
}

const spring = (w: { season: { id: SeasonId } }) => ({
  id: w.season.id,
  ...SPRING,
});

describe("the owner dashboard", () => {
  it("counts members, money, teams, events and check-ins across seasons", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dashboardWorld(db);
      const data = await ownerDashboard(db, w.leagueId, spring(w));
      // Drafts are left out.
      expect(data.seasons.map((s) => s.slug)).toEqual([
        w.slugs.spring,
        w.slugs.fall,
      ]);
      const view = buildDashboardView(data, spring(w));

      const [fall, now] = view.membership;
      expect(fall).toMatchObject({
        name: "Fall 2026",
        members: 3,
        newMembers: 3,
      });
      // Spring: the captain came back; the teammate, the free agent and the
      // other captain are new. One of fall's three returned.
      expect(now).toMatchObject({
        name: "Spring 2027",
        members: 4,
        newMembers: 3,
        returning: 1,
        retained: 1,
        previousMembers: 3,
      });
      expect(now?.retention).toBeCloseTo(1 / 3);

      const money = view.selected.money;
      expect(money).toMatchObject({
        registrationsCents: 0,
        ticketsCents: 1500,
        offAppCents: 4500,
        refundsCents: 500,
        incomeCents: 5500,
        expenseTotalCents: 3000,
        netCents: 2500,
      });
      expect(view.money.find((m) => m.name === "Fall 2026")?.incomeCents).toBe(
        0,
      );

      const teams = new Map(view.selected.teams.map((t) => [t.name, t]));
      expect(teams.get("Kick Bottom")).toMatchObject({
        members: 2,
        target: 10,
      });
      expect(teams.get("Base Invaders")).toMatchObject({ members: 1 });
      expect(teams.get("Not on a team yet")).toMatchObject({
        teamSeasonId: null,
        members: 1,
        signUpRate: null,
      });
      expect(view.selected.teams.reduce((n, t) => n + t.members, 0)).toBe(
        now?.members,
      );

      expect(
        view.selected.events.map((e) => [e.title, e.signedUp, e.checkedIn]),
      ).toEqual([
        ["Park picnic", 1, null],
        ["Bowling night", 2, 1],
      ]);
      expect(view.selected.events[1]?.turnout).toBe(0.5);

      const weeks = view.selected.checkins.filter((c) => c.checkins > 0);
      expect(weeks.map((c) => [c.weekOf, c.checkins])).toEqual([
        ["2027-04-12", 3],
        ["2027-04-19", 1],
      ]);
      expect(weeks[0]?.bySponsor).toEqual([
        { sponsor: "Dugout Tavern", checkins: 2 },
        { sponsor: "The Corner Pocket", checkins: 1 },
      ]);
    });
  });

  it("agrees with the waiver and payment status of each registration", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dashboardWorld(db);
      const view = buildDashboardView(
        await ownerDashboard(db, w.leagueId, spring(w)),
        spring(w),
      );
      const rows = await db
        .select({
          status: registration.status,
          signed: registration.waiverSignatureId,
        })
        .from(registration)
        .where(eq(registration.seasonId, w.season.id));
      const members = rows.filter((r) => r.status !== "cancelled");
      const now = view.selected.membership;
      expect(now?.paid).toBe(
        members.filter((r) => r.status === "active").length,
      );
      expect(now?.signed).toBe(
        members.filter(
          (r) => r.signed !== null || r.status !== "pending_waiver",
        ).length,
      );
      expect(view.selected.teams.reduce((n, t) => n + t.paid, 0)).toBe(
        now?.paid,
      );
    });
  });

  it("is for owners and the operator, never an admin or a captain", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dashboardWorld(db);
      await db
        .update(profile)
        .set({ globalRole: "owner" })
        .where(eq(profile.userId, w.otherCaptain));
      const subject = (id: UserId) => loadSubject(db, id);
      const admin = await subject(w.admin);
      const captain = await subject(w.captain);
      const owner = await subject(w.otherCaptain);
      expect(admin.globalRole).toBe("admin");
      for (const action of [
        "dashboard.view",
        "money_summary.publish",
      ] as const) {
        expect(can(admin, action)).toBe(false);
        expect(can(captain, action)).toBe(false);
        expect(can(owner, action)).toBe(true);
        expect(can({ ...admin, isOperator: true }, action)).toBe(true);
      }
    });
  });
});

describe("the season money summary", () => {
  it("is private until published, then public with totals only", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dashboardWorld(db);
      const [s] = (await dashboardSeasons(db, w.leagueId)).filter(
        (x) => x.id === w.season.id,
      );
      if (!s) throw new Error("no season");
      // Off by default: the season is public, its summary is not.
      expect(await publicSummary(db, w.slugs.spring)).toMatchObject({
        summary: null,
        publishedAt: null,
      });
      expect(await publishedSummarySeasons(db)).not.toContainEqual(
        expect.objectContaining({ slug: w.slugs.spring }),
      );

      const inputs = await summaryInputs(db, w.leagueId, s.id);
      expect(inputs.members).toBe(4);
      const money = seasonMoney({ seasonId: s.id, ...inputs });
      const summary = buildMoneySummary(money, seasonFees(s), ["refs"]);
      // Too few members: one total could stand for one person's payment.
      expect(publishBlocker({ members: inputs.members, summary })).toBe(
        "too_few_members",
      );

      await publishSummary(
        db,
        { seasonId: s.id, folded: ["refs", "refs"], summary },
        w.captain,
        NOW,
      );
      const shown = await publicSummary(db, w.slugs.spring);
      expect(shown?.publishedAt).toEqual(NOW);
      expect(shown?.summary).toEqual(summary);
      expect(shown?.summary?.categories).toEqual([
        { label: "Other", cents: 3000, share: 3000 / 5500 },
      ]);
      // Nothing about any person: no name, email or note from the world.
      const text = JSON.stringify(shown);
      for (const word of [
        ...w.emails,
        "Robin",
        "Kicker",
        "Opening day ref",
        "paid at the field",
      ])
        expect(text).not.toContain(word);
      const [stored] = await db
        .select({ folded: moneySummary.folded })
        .from(moneySummary)
        .where(eq(moneySummary.seasonId, s.id));
      expect(stored?.folded).toEqual(["refs"]);

      // Publishing again replaces it.
      await publishSummary(
        db,
        {
          seasonId: s.id,
          folded: [],
          summary: buildMoneySummary(money, [], []),
        },
        w.captain,
        NOW,
      );
      expect(
        (await publicSummary(db, w.slugs.spring))?.summary?.categories,
      ).toEqual([{ label: "Refs", cents: 3000, share: 3000 / 5500 }]);

      expect(await unpublishSummary(db, s.id, w.captain)).toEqual({
        ok: true,
        value: null,
      });
      expect(await unpublishSummary(db, s.id, w.captain)).toEqual({
        ok: false,
        error: "not_published",
      });
      expect((await publicSummary(db, w.slugs.spring))?.summary).toBeNull();

      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, s.id));
      expect(
        audits
          .map((a) => a.action)
          .filter((a) => a.startsWith("money_summary")),
      ).toEqual([
        "money_summary.publish",
        "money_summary.publish",
        "money_summary.unpublish",
      ]);
    });
  });

  it("never shows a draft season's summary", async () => {
    await inRolledBackDb(async (db) => {
      const w = await dashboardWorld(db);
      await publishSummary(
        db,
        {
          seasonId: w.draftId,
          folded: [],
          summary: buildMoneySummary({ incomeCents: 0, expenses: [] }, [], []),
        },
        w.captain,
        NOW,
      );
      expect(await publicSummary(db, w.slugs.draft)).toBeNull();
      expect(await publishedSummarySeasons(db)).not.toContainEqual(
        expect.objectContaining({ slug: w.slugs.draft }),
      );
    });
  });
});
