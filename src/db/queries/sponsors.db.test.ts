import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { DealId, SponsorId } from "@/domain/ids";
import type { DealTerms } from "@/domain/sponsors/deals";
import { auditLog } from "../schema/audit";
import { season } from "../schema/season";
import { checkin, deal, sponsor, sponsorMember } from "../schema/sponsor";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount } from "./account";
import type { Db } from "./schedule";
import {
  addSponsorMember,
  checkIn,
  confirmDeals,
  createSponsor,
  redeemDeal,
  removeSponsor,
  saveDeal,
  setDealActive,
  setTeamOfWeek,
  sponsorDirectory,
  sponsorForCheckIn,
  sponsorWeeklyCounts,
  updateSponsor,
} from "./sponsors";
import { loadSubject } from "./subject";

afterAll(closePool);

const NOW = new Date("2027-04-13T23:30:00Z");
const TZ = "America/New_York";

const bar = {
  name: "The Corner Pocket",
  slug: "the-corner-pocket",
  kind: "bar" as const,
  isHomeBar: true,
  blurb: "Shuffleboard, big booths and a kitchen open late.",
  address: "1 Example St, Brooklyn, NY",
  url: "https://corner-pocket.example.test/",
};

const terms = (over: Partial<DealTerms> = {}): DealTerms => ({
  title: "$2 off any burger",
  terms: null,
  validDays: [],
  validFrom: null,
  validTo: null,
  ...over,
});

async function setUp(db: Db) {
  const w = await leagueWorld(db);
  const created = await createSponsor(db, {
    ...bar,
    leagueId: w.leagueId,
    actorId: w.admin,
  });
  if (!created.ok) throw new Error(created.error);
  const sponsorId = created.value;
  const addDeal = async (over: Partial<DealTerms> = {}) => {
    const saved = await saveDeal(db, {
      sponsorId,
      dealId: null,
      terms: terms(over),
      actorId: w.admin,
      now: NOW,
    });
    if (!saved.ok) throw new Error(saved.error);
    return saved.value;
  };
  return { w, sponsorId, addDeal };
}

describe("sponsors", () => {
  it("keeps one home bar: a new one takes the mark", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId } = await setUp(db);
      const next = await createSponsor(db, {
        ...bar,
        name: "Side Pocket",
        slug: "side-pocket",
        leagueId: w.leagueId,
        actorId: w.admin,
      });
      expect(next.ok).toBe(true);
      const rows = await db
        .select({ id: sponsor.id, home: sponsor.isHomeBar })
        .from(sponsor)
        .where(eq(sponsor.leagueId, w.leagueId));
      expect(rows.find((r) => r.id === sponsorId)?.home).toBe(false);
      expect(rows.filter((r) => r.home)).toHaveLength(1);
      expect(
        await createSponsor(db, {
          ...bar,
          isHomeBar: false,
          leagueId: w.leagueId,
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "slug_taken" });
    });
  });

  it("gives each sponsor its own long secret, read only for check-ins", async () => {
    await inRolledBackDb(async (db) => {
      const { sponsorId } = await setUp(db);
      const found = await sponsorForCheckIn(db, bar.slug);
      expect(found?.id).toBe(sponsorId);
      expect(found?.secret).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("lists live sponsors, home bar first, with active deals and no secret", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId, addDeal } = await setUp(db);
      await createSponsor(db, {
        ...bar,
        name: "Bounce Supply",
        slug: "bounce-supply",
        kind: "brand",
        isHomeBar: false,
        leagueId: w.leagueId,
        actorId: w.admin,
      });
      const gone = await createSponsor(db, {
        ...bar,
        name: "Gone Grill",
        slug: "gone-grill",
        isHomeBar: false,
        leagueId: w.leagueId,
        actorId: w.admin,
      });
      if (gone.ok)
        await removeSponsor(db, {
          sponsorId: gone.value,
          actorId: w.admin,
          now: NOW,
        });
      await addDeal();
      const off = await addDeal({ title: "Old deal" });
      await setDealActive(db, {
        sponsorId,
        dealId: off,
        active: false,
        actorId: w.admin,
        now: NOW,
      });
      const { sponsors } = await sponsorDirectory(db, w.leagueId, TZ);
      expect(sponsors.map((s) => s.slug)).toEqual([
        "the-corner-pocket",
        "bounce-supply",
      ]);
      const [home] = sponsors;
      expect(home?.deals.map((d) => [d.title, d.confirmedOn])).toEqual([
        // 23:30 UTC is still the 13th in New York.
        ["$2 off any burger", "2027-04-13"],
      ]);
      expect(JSON.stringify(sponsors)).not.toContain("secret");
    });
  });

  it("lets a sponsor's own people edit what players read, not the rest", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId } = await setUp(db);
      const result = await updateSponsor(db, {
        sponsorId,
        details: {
          ...bar,
          blurb: "New blurb",
          slug: "hijacked",
          isHomeBar: false,
          kind: "brand",
        },
        asAdmin: false,
        actorId: w.captain,
      });
      expect(result.ok).toBe(true);
      const [row] = await db
        .select({
          slug: sponsor.slug,
          blurb: sponsor.blurb,
          home: sponsor.isHomeBar,
          kind: sponsor.kind,
        })
        .from(sponsor)
        .where(eq(sponsor.id, sponsorId));
      expect(row).toEqual({
        slug: bar.slug,
        blurb: "New blurb",
        home: true,
        kind: "bar",
      });
    });
  });

  it("confirms every active deal at once, with an audit row", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId, addDeal } = await setUp(db);
      await addDeal();
      await addDeal({ title: "Free fries with a check-in" });
      const later = new Date("2027-04-20T16:00:00Z");
      expect(
        await confirmDeals(db, { sponsorId, actorId: w.admin, now: later }),
      ).toBe(2);
      const dates = await db
        .select({ at: deal.confirmedAt })
        .from(deal)
        .where(eq(deal.sponsorId, sponsorId));
      expect(dates.every((d) => d.at.getTime() === later.getTime())).toBe(
        true,
      );
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, sponsorId));
      expect(audits.map((a) => a.action)).toContain("deal.confirm");
    });
  });
});

describe("check-ins and deals", () => {
  it("checks a player in once a day, with their team in a season being played", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId } = await setUp(db);
      await db
        .update(season)
        .set({ status: "in_progress" })
        .where(eq(season.id, w.season.id));
      const first = await checkIn(db, {
        sponsorId,
        userId: w.teammate,
        onDate: "2027-04-13",
        now: NOW,
      });
      const again = await checkIn(db, {
        sponsorId,
        userId: w.teammate,
        onDate: "2027-04-13",
        now: new Date(NOW.getTime() + 60_000),
      });
      expect(first.first).toBe(true);
      expect(again).toEqual({ checkinId: first.checkinId, first: false });
      const rows = await db
        .select({ team: checkin.teamSeasonId, at: checkin.checkedInAt })
        .from(checkin)
        .where(eq(checkin.sponsorId, sponsorId));
      expect(rows).toEqual([{ team: w.teamSeasonId, at: NOW }]);
    });
  });

  it("uses a deal once a visit, only when it is on", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId, addDeal } = await setUp(db);
      // 2027-04-13 is a Tuesday.
      const tuesdayNights = await addDeal({
        validDays: [2],
        validFrom: "18:00",
        validTo: "23:00",
      });
      const redeem = (dealId: DealId, time: string) =>
        redeemDeal(db, {
          sponsorId,
          dealId,
          userId: w.agent,
          onDate: "2027-04-13",
          time,
          now: NOW,
        });
      expect(await redeem(tuesdayNights, "19:30")).toEqual({
        ok: false,
        error: "not_checked_in",
      });
      await checkIn(db, {
        sponsorId,
        userId: w.agent,
        onDate: "2027-04-13",
        now: NOW,
      });
      expect(await redeem(tuesdayNights, "17:00")).toEqual({
        ok: false,
        error: "not_available",
      });
      expect(await redeem(tuesdayNights, "19:30")).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await redeem(tuesdayNights, "19:45")).toEqual({
        ok: false,
        error: "already_used",
      });
      // Another sponsor's deal is not on offer here.
      const other = await createSponsor(db, {
        ...bar,
        slug: "elsewhere",
        isHomeBar: false,
        leagueId: w.leagueId,
        actorId: w.admin,
      });
      if (!other.ok) throw new Error(other.error);
      const theirs = await saveDeal(db, {
        sponsorId: other.value,
        dealId: null,
        terms: terms(),
        actorId: w.admin,
        now: NOW,
      });
      if (!theirs.ok) throw new Error(theirs.error);
      expect(await redeem(theirs.value, "19:30")).toEqual({
        ok: false,
        error: "not_available",
      });
    });
  });

  it("counts check-ins, players, teams and deals by week", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId, addDeal } = await setUp(db);
      await db
        .update(season)
        .set({ status: "in_progress" })
        .where(eq(season.id, w.season.id));
      const burger = await addDeal();
      // Two visits the week of Monday April 12, one the week before.
      for (const [userId, onDate] of [
        [w.captain, "2027-04-13"],
        [w.teammate, "2027-04-18"],
        [w.captain, "2027-04-06"],
      ] as const) {
        await checkIn(db, { sponsorId, userId, onDate, now: NOW });
        await redeemDeal(db, {
          sponsorId,
          dealId: burger,
          userId,
          onDate,
          time: "20:00",
          now: NOW,
        });
      }
      const counts = await sponsorWeeklyCounts(db, sponsorId, "2027-04-05");
      expect(
        [...counts.weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
      ).toEqual([
        {
          weekOf: "2027-04-05",
          checkIns: 1,
          players: 1,
          teams: 1,
          dealsUsed: 1,
        },
        {
          weekOf: "2027-04-12",
          checkIns: 2,
          players: 2,
          teams: 1,
          dealsUsed: 2,
        },
      ]);
      expect(counts.deals).toContainEqual({
        weekOf: "2027-04-12",
        dealId: burger,
        count: 2,
      });
    });
  });

  it("keeps check-ins counted when a player deletes their account", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId } = await setUp(db);
      await addSponsorMember(db, {
        sponsorId,
        email: w.emails[2] ?? "",
        actorId: w.admin,
      });
      await checkIn(db, {
        sponsorId,
        userId: w.agent,
        onDate: "2027-04-13",
        now: NOW,
      });
      const deleted = await deleteAccount(db, w.agent, NOW);
      expect(deleted.ok).toBe(true);
      expect(
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(sponsorMember)
          .where(eq(sponsorMember.userId, w.agent)),
      ).toEqual([{ n: 0 }]);
      expect(
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(checkin)
          .where(eq(checkin.sponsorId, sponsorId)),
      ).toEqual([{ n: 1 }]);
    });
  });
});

describe("sponsor members", () => {
  it("adds a person by email, and their permissions include the sponsor", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId } = await setUp(db);
      const email = (w.emails[1] ?? "").toUpperCase();
      expect(
        await addSponsorMember(db, { sponsorId, email, actorId: w.admin }),
      ).toEqual({ ok: true, value: undefined });
      expect(
        await addSponsorMember(db, { sponsorId, email, actorId: w.admin }),
      ).toEqual({ ok: false, error: "already_member" });
      expect(
        await addSponsorMember(db, {
          sponsorId,
          email: "nobody@example.test",
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "no_account" });
      expect((await loadSubject(db, w.teammate)).sponsorIds).toEqual([
        sponsorId,
      ]);
      // A sponsor taken off the site no longer grants anything.
      await removeSponsor(db, { sponsorId, actorId: w.admin, now: NOW });
      expect((await loadSubject(db, w.teammate)).sponsorIds).toEqual([]);
    });
  });
});

describe("team of the week", () => {
  it("names one team per game day and shows the latest on the sponsor pages", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sponsorId } = await setUp(db);
      const name = (weekOf: string, teamSeasonId = w.teamSeasonId) =>
        setTeamOfWeek(db, {
          seasonId: w.season.id,
          weekOf,
          teamSeasonId,
          sponsorId: sponsorId as SponsorId,
          tabCents: 5000,
          reason: "Took down No. 1.",
          actorId: w.admin,
        });
      expect((await name("2027-04-06")).ok).toBe(true);
      expect((await name("2027-04-13")).ok).toBe(true);
      // Renaming the same day replaces the pick.
      expect((await name("2027-04-13", w.otherTeamSeasonId)).ok).toBe(true);
      const { teamOfWeek } = await sponsorDirectory(db, w.leagueId, TZ);
      expect(teamOfWeek).toMatchObject({
        weekOf: "2027-04-13",
        teamName: "Base Invaders",
        tabCents: 5000,
        sponsorSlug: bar.slug,
      });
    });
  });

  it("refuses a team from another season", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await setUp(db);
      const other = await leagueWorld(db);
      expect(
        await setTeamOfWeek(db, {
          seasonId: w.season.id,
          weekOf: "2027-04-13",
          teamSeasonId: other.teamSeasonId,
          sponsorId: null,
          tabCents: null,
          reason: "Not ours.",
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "not_in_season" });
    });
  });
});
