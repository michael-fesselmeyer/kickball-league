import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { field, slot, venue } from "../schema/game";
import { message } from "../schema/message";
import { blackout, permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { leagueWorld } from "../test/league-world";
import { grantRole } from "../test/leagues";
import { closePool, inRolledBackDb } from "../test/transaction";
import { queuePermitAlerts, seasonPermitPlan } from "./permit-plan";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2027-04-05T15:00:00Z");

/**
 * Spring 2027 at McCarren Park's Baseball 2 (natural grass in NYC Parks'
 * data): permit 123456 on three Sundays, noon to 6 pm, the first rained
 * out and the third blacked out, and permit 654321 on four more Sundays.
 * 42 permitted hours in all, so the season is close to the 50-hour line.
 */
async function permitWorld(db: Db) {
  const w = await leagueWorld(db);
  const [v] = await db
    .insert(venue)
    .values({
      leagueId: w.leagueId,
      name: "McCarren Park",
      slug: "mccarren-park",
      lat: "40.720700",
      lng: "-73.953000",
    })
    .returning({ id: venue.id });
  if (!v) throw new Error("no venue");
  const [f] = await db
    .insert(field)
    .values({ venueId: v.id, name: "Baseball 2" })
    .returning({ id: field.id });
  if (!f) throw new Error("no field");
  const sunday = (d: string, permitNumber: string, lost = false) => ({
    fieldId: f.id,
    seasonId: w.season.id,
    startsAt: new Date(`${d}T16:00:00Z`),
    endsAt: new Date(`${d}T22:00:00Z`),
    permitNumber,
    status: lost ? ("lost" as const) : ("confirmed" as const),
  });
  const windows = await db
    .insert(permitWindow)
    .values([
      sunday("2027-04-11", "123456"),
      sunday("2027-04-18", "123456"),
      sunday("2027-04-25", "123456"),
      ...["2027-05-02", "2027-05-09", "2027-05-16", "2027-05-23"].map((d) =>
        sunday(d, "654321"),
      ),
      sunday("2027-05-30", "999999", true),
    ])
    .returning({ id: permitWindow.id, startsAt: permitWindow.startsAt });
  const [rainedOut, played] = windows;
  if (!rainedOut || !played) throw new Error("no windows");
  await db.insert(slot).values([
    {
      seasonId: w.season.id,
      fieldId: f.id,
      permitWindowId: rainedOut.id,
      startsAt: new Date("2027-04-11T16:00:00Z"),
      endsAt: new Date("2027-04-11T17:00:00Z"),
      timeIndex: 0,
      status: "cancelled" as const,
    },
    {
      seasonId: w.season.id,
      fieldId: f.id,
      permitWindowId: played.id,
      startsAt: new Date("2027-04-18T16:00:00Z"),
      endsAt: new Date("2027-04-18T17:00:00Z"),
      timeIndex: 0,
    },
  ]);
  await db
    .insert(blackout)
    .values({ seasonId: w.season.id, onDate: "2027-04-25", reason: "Holiday" });
  return { ...w, fieldId: f.id };
}

const holder = {
  name: "Example Kickball League",
  timeZone: "America/New_York",
};

describe("seasonPermitPlan", () => {
  it("estimates the fees, counts the hours and finds the time to give back", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      const plan = await seasonPermitPlan(db, w.season.id, holder, NOW);
      expect(plan.fees.get("n:123456")).toMatchObject({
        surface: "grass",
        basis: "matched",
        park: "McCarren Park",
        borough: "B",
        costEntered: false,
        // 18 hours at $24, all before sunset.
        estimate: { minutes: 1080, litMinutes: 0, cents: 43_200 },
      });
      expect(plan.fees.has("n:999999")).toBe(false);
      expect(plan.expectedCents).toBe(42 * 2400);
      expect(plan.minutes).toBe(42 * 60);
      expect(plan.level).toBe("near");
      expect(
        plan.unused.map((u) => ({
          on: u.on,
          reason: u.reason,
          office: u.office?.phone,
        })),
      ).toEqual([
        { on: "2027-04-11", reason: "rained_out", office: "(718) 965-8975" },
        { on: "2027-04-25", reason: "blackout", office: "(718) 965-8975" },
      ]);
    });
  });

  it("stops counting a permit as expected once its cost is entered", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      await db
        .update(permitWindow)
        .set({ costCents: 10_000 })
        .where(eq(permitWindow.permitNumber, "123456"));
      const plan = await seasonPermitPlan(db, w.season.id, holder, NOW);
      expect(plan.fees.get("n:123456")?.costEntered).toBe(true);
      expect(plan.expectedCents).toBe(24 * 2400);
    });
  });
});

describe("queuePermitAlerts", () => {
  it("tells each owner once about the hours and each window to give back", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      await grantRole(db, w.captain, "owner", w.leagueId);
      const mine = (userId: UserId) =>
        db
          .select({ key: message.dedupeKey, payload: message.payload })
          .from(message)
          .where(
            and(
              eq(message.userId, userId),
              eq(message.template, "permit_alert"),
            ),
          );

      expect(await queuePermitAlerts(db, w.leagueId, NOW)).toBe(3);
      expect(await queuePermitAlerts(db, w.leagueId, NOW)).toBe(0);
      const sent = await mine(w.captain);
      expect(sent.map((m) => m.payload)).toEqual(
        expect.arrayContaining([
          {
            kind: "hours_near",
            season: "Spring 2027",
            seasonSlug: "spring-2027",
            hours: 42,
            line: 40,
          },
          {
            kind: "give_back",
            season: "Spring 2027",
            seasonSlug: "spring-2027",
            on: "2027-04-11",
            place: "McCarren Park, Baseball 2",
            hours: "12:00–18:00",
            permitNumber: "123456",
            office: { name: "Brooklyn permit office", phone: "(718) 965-8975" },
          },
        ]),
      );
      // Nobody but owners hears about it.
      expect(await mine(w.admin)).toEqual([]);

      // Past the line, one more.
      await db.insert(permitWindow).values(
        ["2027-06-06", "2027-06-13"].map((d) => ({
          fieldId: w.fieldId,
          seasonId: w.season.id,
          startsAt: new Date(`${d}T16:00:00Z`),
          endsAt: new Date(`${d}T22:00:00Z`),
          status: "requested" as const,
        })),
      );
      expect(await queuePermitAlerts(db, w.leagueId, NOW)).toBe(1);
      expect((await mine(w.captain)).map((m) => m.key)).toContain(
        `permit-hours/${w.season.id}/over/${w.captain}`,
      );
    });
  });

  it("sends nothing for a season that is over", async () => {
    await inRolledBackDb(async (db) => {
      const w = await permitWorld(db);
      await grantRole(db, w.captain, "owner", w.leagueId);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      expect(await queuePermitAlerts(db, w.leagueId, NOW)).toBe(0);
    });
  });
});
