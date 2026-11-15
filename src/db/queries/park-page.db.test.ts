import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { closePool, inRolledBackDb } from "../test/transaction";
import { addField, addPermitWindows, addVenue } from "./fields";
import { parkPermitWindows, publicParkBySlug, publicParks } from "./park-page";
import type { Db } from "./schedule";

afterAll(closePool);

const NY = "America/New_York";

async function world(db: Db, name: string) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `park-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name, slug: `park-${tag}` })
    .returning({ id: league.id });
  return { actor: admin!.id, leagueId: lg!.id };
}

async function seasonOf(
  db: Db,
  leagueId: (typeof league.$inferSelect)["id"],
  status: "draft" | "registration_open" | "in_progress",
  visibility: "league" | "private" = "league",
) {
  const [sn] = await db
    .insert(season)
    .values({
      leagueId,
      name: `Season ${status}`,
      slug: `s-${Math.random().toString(36).slice(2, 8)}`,
      status,
      visibility,
      startsOn: "2027-04-05",
      endsOn: "2027-06-28",
      feeModel: "per_team",
      teamFeeCents: 100000,
      rosterMin: 12,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  return sn!.id;
}

async function park(db: Db, w: Awaited<ReturnType<typeof world>>) {
  const venue = await addVenue(
    db,
    { leagueId: w.leagueId, name: "McCarren Park", neighborhood: "Greenpoint" },
    w.actor,
  );
  if (!venue.ok) throw new Error(venue.error);
  const f = await addField(
    db,
    { leagueId: w.leagueId, venueId: venue.value, name: "Field 1" },
    w.actor,
  );
  if (!f.ok) throw new Error(f.error);
  return { venueId: venue.value, fieldId: f.value };
}

const permits = (
  db: Db,
  w: Awaited<ReturnType<typeof world>>,
  seasonId: Awaited<ReturnType<typeof seasonOf>>,
  fieldId: Awaited<ReturnType<typeof park>>["fieldId"],
  status: "requested" | "confirmed" | "lost",
  permitNumber = "B-100",
) =>
  addPermitWindows(
    db,
    {
      leagueId: w.leagueId,
      seasonId,
      fieldId,
      dates: ["2027-04-05", "2027-04-12"],
      startTime: "20:00",
      endTime: "22:00",
      timeZone: NY,
      permitNumber,
      status,
    },
    w.actor,
  );

const LONG_AGO = new Date("2027-01-01T00:00:00Z");

describe("a park's public page reads", () => {
  it("finds the park by its slug, in its own league only", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, "One");
      const other = await world(db, "Two");
      await park(db, w);
      expect(
        (await publicParkBySlug(db, w.leagueId, "mccarren-park"))?.name,
      ).toBe("McCarren Park");
      expect(
        await publicParkBySlug(db, other.leagueId, "mccarren-park"),
      ).toBeNull();
      expect(await publicParkBySlug(db, w.leagueId, "nowhere")).toBeNull();
    }));

  it("lists confirmed permits with number, field and hours, and nothing private", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, "One");
      const p = await park(db, w);
      const sn = await seasonOf(db, w.leagueId, "in_progress");
      await permits(db, w, sn, p.fieldId, "confirmed");
      const windows = await parkPermitWindows(db, p.venueId, LONG_AGO);
      expect(windows).toHaveLength(2);
      expect(windows[0]).toEqual({
        fieldId: p.fieldId,
        fieldName: "Field 1",
        sortOrder: 0,
        startsAt: new Date("2027-04-06T00:00:00Z"),
        endsAt: new Date("2027-04-06T02:00:00Z"),
        permitNumber: "B-100",
      });
    }));

  it("leaves out requested and lost permits, drafts and private seasons", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, "One");
      const p = await park(db, w);
      const active = await seasonOf(db, w.leagueId, "in_progress");
      const draft = await seasonOf(db, w.leagueId, "draft");
      const priv = await seasonOf(db, w.leagueId, "in_progress", "private");
      await permits(db, w, active, p.fieldId, "requested", "B-1");
      await permits(db, w, active, p.fieldId, "lost", "B-2");
      await permits(db, w, draft, p.fieldId, "confirmed", "B-3");
      await permits(db, w, priv, p.fieldId, "confirmed", "B-4");
      expect(await parkPermitWindows(db, p.venueId, LONG_AGO)).toEqual([]);
      expect(await publicParks(db, w.leagueId)).toEqual([]);
    }));

  it("drops windows that have ended and keeps one under way", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, "One");
      const p = await park(db, w);
      const sn = await seasonOf(db, w.leagueId, "in_progress");
      await permits(db, w, sn, p.fieldId, "confirmed");
      // 01:00 UTC on Apr 6 is inside the first window, 03:00 is after it.
      const during = await parkPermitWindows(
        db,
        p.venueId,
        new Date("2027-04-06T01:00:00Z"),
      );
      expect(during).toHaveLength(2);
      const after = await parkPermitWindows(
        db,
        p.venueId,
        new Date("2027-04-06T03:00:00Z"),
      );
      expect(after).toHaveLength(1);
    }));

  it("lists a park once, however many permits it has", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, "One");
      const p = await park(db, w);
      const sn = await seasonOf(db, w.leagueId, "in_progress");
      await permits(db, w, sn, p.fieldId, "confirmed");
      const parks = await publicParks(db, w.leagueId);
      expect(parks.map((x) => x.slug)).toEqual(["mccarren-park"]);
      expect(
        await db
          .select({ id: league.id })
          .from(league)
          .where(eq(league.id, w.leagueId)),
      ).toHaveLength(1);
    }));
});
