import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { FieldId, LeagueId, SeasonId, UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  addBlackout,
  addField,
  addPermitWindows,
  addVenue,
  fieldsScreen,
  removeBlackout,
  removePermitWindow,
  setPermitStatus,
  syncSlots,
} from "./fields";
import type { Db } from "./schedule";

afterAll(closePool);

const NY = "America/New_York";
const MONDAYS = ["2027-04-05", "2027-04-12", "2027-04-19"];

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `fields-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `fields-${tag}` })
    .returning({ id: league.id });
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
      name: "Spring",
      slug: "spring",
      startsOn: "2027-04-05",
      endsOn: "2027-06-28",
      feeModel: "per_team",
      teamFeeCents: 100000,
      rosterMin: 12,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  return {
    actor: admin!.id as UserId,
    leagueId: lg!.id as LeagueId,
    seasonId: sn!.id as SeasonId,
  };
}

/** A venue with two fields and Monday 8–10 pm permits on both. */
async function withPermits(db: Db) {
  const w = await world(db);
  const venue = await addVenue(
    db,
    { leagueId: w.leagueId, name: "McCarren Park", neighborhood: "Greenpoint" },
    w.actor,
  );
  if (!venue.ok) throw new Error(venue.error);
  const fields: FieldId[] = [];
  for (const name of ["Field 1", "Field 2"]) {
    const f = await addField(
      db,
      { leagueId: w.leagueId, venueId: venue.value, name },
      w.actor,
    );
    if (!f.ok) throw new Error(f.error);
    fields.push(f.value);
  }
  for (const fieldId of fields)
    await addPermitWindows(
      db,
      {
        leagueId: w.leagueId,
        seasonId: w.seasonId,
        fieldId,
        dates: MONDAYS,
        startTime: "20:00",
        endTime: "22:00",
        timeZone: NY,
        status: "confirmed",
      },
      w.actor,
    );
  return { ...w, venueId: venue.value, fields };
}

const sync = (db: Db, w: { seasonId: SeasonId; actor: UserId }, minutes = 60) =>
  syncSlots(
    db,
    { seasonId: w.seasonId, slotMinutes: minutes, timeZone: NY },
    w.actor,
  );

describe("venues and fields", () => {
  it("adds a venue and fields, rejecting duplicates and other leagues' venues", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withPermits(db);
      expect(
        await addVenue(
          db,
          { leagueId: w.leagueId, name: "mccarren park" },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "duplicate" });
      expect(
        await addVenue(db, { leagueId: w.leagueId, name: "  " }, w.actor),
      ).toEqual({ ok: false, error: "invalid_name" });
      expect(
        await addField(
          db,
          { leagueId: w.leagueId, venueId: w.venueId, name: "field 1" },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "duplicate" });
      expect(
        await addField(
          db,
          { leagueId: w.leagueId, venueId: w.venueId, name: "" },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "invalid_name" });
      const other = await world(db);
      expect(
        await addField(
          db,
          { leagueId: other.leagueId, venueId: w.venueId, name: "Field 9" },
          other.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_venue" });

      const screen = await fieldsScreen(db, w.leagueId, w.seasonId);
      expect(screen.venues.map((v) => v.name)).toEqual(["McCarren Park"]);
      expect(screen.venues[0]?.fields.map((f) => f.name)).toEqual([
        "Field 1",
        "Field 2",
      ]);
      const actions = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.actorId, w.actor));
      expect(actions.map((a) => a.action)).toEqual([
        "venue.create",
        "field.create",
        "field.create",
        "permit.create",
        "permit.create",
      ]);
    });
  });
});

describe("permit windows", () => {
  it("stores local hours as instants across the daylight-saving change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const venue = await addVenue(
        db,
        { leagueId: w.leagueId, name: "Park" },
        w.actor,
      );
      if (!venue.ok) throw new Error();
      const f = await addField(
        db,
        { leagueId: w.leagueId, venueId: venue.value, name: "Field 1" },
        w.actor,
      );
      if (!f.ok) throw new Error();
      const base = {
        leagueId: w.leagueId,
        seasonId: w.seasonId,
        fieldId: f.value,
        timeZone: NY,
        status: "requested" as const,
      };
      expect(
        await addPermitWindows(
          db,
          {
            ...base,
            dates: ["2027-03-08", "2027-03-15"],
            startTime: "20:00",
            endTime: "22:00",
          },
          w.actor,
        ),
      ).toEqual({ ok: true, value: 2 });
      const rows = await db
        .select({ startsAt: permitWindow.startsAt })
        .from(permitWindow)
        .where(eq(permitWindow.seasonId, w.seasonId))
        .orderBy(permitWindow.startsAt);
      expect(rows.map((r) => r.startsAt.toISOString())).toEqual([
        "2027-03-09T01:00:00.000Z",
        "2027-03-16T00:00:00.000Z",
      ]);
      expect(
        await addPermitWindows(
          db,
          {
            ...base,
            dates: ["2027-03-22"],
            startTime: "22:00",
            endTime: "20:00",
          },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "end_before_start" });
      expect(
        await addPermitWindows(
          db,
          { ...base, dates: [], startTime: "20:00", endTime: "22:00" },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "no_dates" });
      const other = await world(db);
      expect(
        await addPermitWindows(
          db,
          {
            ...base,
            leagueId: other.leagueId,
            dates: ["2027-03-22"],
            startTime: "20:00",
            endTime: "22:00",
          },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_field" });
    });
  });
});

describe("syncSlots", () => {
  it("cuts permits into slots, minus blackouts, with time indexes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withPermits(db);
      expect(await sync(db, w)).toEqual({
        ok: true,
        value: { added: 12, kept: 0, removed: 0, retired: 0 },
      });
      await addBlackout(
        db,
        { ...w, onDate: "2027-04-12", fieldId: null, reason: "Park event" },
        w.actor,
      );
      await addBlackout(
        db,
        { ...w, onDate: "2027-04-19", fieldId: w.fields[1] as FieldId },
        w.actor,
      );
      expect(await sync(db, w)).toEqual({
        ok: true,
        value: { added: 0, kept: 6, removed: 6, retired: 0 },
      });
      const screen = await fieldsScreen(db, w.leagueId, w.seasonId);
      expect(screen.slots.map((s) => s.timeIndex)).toEqual([0, 0, 1, 1, 0, 1]);
      expect(screen.slots.every((s) => s.permitWindowId !== null)).toBe(true);
    });
  });

  it("keeps slot ids when the length changes the end only, and re-cuts otherwise", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withPermits(db);
      await sync(db, w);
      const before = await fieldsScreen(db, w.leagueId, w.seasonId);
      // 90-minute slots: one per window, starting at 8 pm like before.
      expect(await sync(db, w, 90)).toEqual({
        ok: true,
        value: { added: 0, kept: 6, removed: 6, retired: 0 },
      });
      const after = await fieldsScreen(db, w.leagueId, w.seasonId);
      expect(
        after.slots.every((s) => before.slots.some((b) => b.id === s.id)),
      ).toBe(true);
      expect(
        after.slots.every(
          (s) => s.endsAt.getTime() - s.startsAt.getTime() === 90 * 60_000,
        ),
      ).toBe(true);
      expect(await sync(db, w, 5)).toEqual({ ok: false, error: "bad_length" });
    });
  });

  it("cancels, rather than deletes, a slot a game uses when its permit is lost", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withPermits(db);
      await sync(db, w);
      const [first] = await fieldsScreen(db, w.leagueId, w.seasonId).then(
        (s) => s.slots,
      );
      const teams = await db
        .insert(team)
        .values(
          ["A", "B"].map((n) => ({
            leagueId: w.leagueId,
            name: n,
            slug: n.toLowerCase(),
          })),
        )
        .returning({ id: team.id });
      const entries = await db
        .insert(teamSeason)
        .values(teams.map((t) => ({ teamId: t.id, seasonId: w.seasonId })))
        .returning({ id: teamSeason.id });
      await db.insert(game).values({
        seasonId: w.seasonId,
        teamAId: entries[0]!.id,
        teamBId: entries[1]!.id,
        slotId: first!.id,
      });
      const [permit] = await db
        .select({ id: permitWindow.id })
        .from(permitWindow)
        .where(
          and(
            eq(permitWindow.seasonId, w.seasonId),
            eq(permitWindow.id, first!.permitWindowId!),
          ),
        );
      expect(
        await setPermitStatus(
          db,
          { seasonId: w.seasonId, permitId: permit!.id, status: "lost" },
          w.actor,
        ),
      ).toEqual({ ok: true, value: undefined });
      expect(await sync(db, w)).toEqual({
        ok: true,
        value: { added: 0, kept: 10, removed: 1, retired: 1 },
      });
      const [kept] = await db
        .select({ status: slot.status })
        .from(slot)
        .where(eq(slot.id, first!.id));
      expect(kept?.status).toBe("cancelled");
      expect(
        await removePermitWindow(
          db,
          { seasonId: w.seasonId, permitId: permit!.id },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "has_slots" });
    });
  });

  it("adopts a slot entered without a permit and leaves other such slots alone", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withPermits(db);
      const [manual] = await db
        .insert(slot)
        .values([
          {
            seasonId: w.seasonId,
            fieldId: w.fields[0] as FieldId,
            startsAt: new Date("2027-04-06T00:00:00Z"),
            endsAt: new Date("2027-04-06T01:00:00Z"),
            timeIndex: 0,
          },
          {
            seasonId: w.seasonId,
            fieldId: w.fields[0] as FieldId,
            startsAt: new Date("2027-05-01T16:00:00Z"),
            endsAt: new Date("2027-05-01T17:00:00Z"),
            timeIndex: 0,
          },
        ])
        .returning({ id: slot.id });
      expect(await sync(db, w)).toEqual({
        ok: true,
        value: { added: 11, kept: 1, removed: 0, retired: 0 },
      });
      const screen = await fieldsScreen(db, w.leagueId, w.seasonId);
      expect(screen.slots).toHaveLength(13);
      expect(
        screen.slots.find((s) => s.id === manual!.id)?.permitWindowId,
      ).not.toBeNull();
    });
  });
});

describe("removing permits and blackouts", () => {
  it("deletes an uncut permit and a blackout, and refuses unknown ones", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withPermits(db);
      const screen = await fieldsScreen(db, w.leagueId, w.seasonId);
      const permitId = screen.permits[0]!.id;
      expect(
        await removePermitWindow(
          db,
          { seasonId: w.seasonId, permitId },
          w.actor,
        ),
      ).toEqual({ ok: true, value: undefined });
      expect(
        await removePermitWindow(
          db,
          { seasonId: w.seasonId, permitId },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_permit" });
      expect(
        await setPermitStatus(
          db,
          { seasonId: w.seasonId, permitId, status: "lost" },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_permit" });

      const added = await addBlackout(
        db,
        { ...w, onDate: "2027-04-12", fieldId: null },
        w.actor,
      );
      expect(added.ok).toBe(true);
      expect(
        await addBlackout(
          db,
          { ...w, onDate: "2027-04-12", fieldId: null },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "duplicate" });
      expect(
        await addBlackout(
          db,
          { ...w, onDate: "April 12", fieldId: null },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "bad_date" });
      const other = await world(db);
      expect(
        await addBlackout(
          db,
          { ...other, onDate: "2027-04-12", fieldId: w.fields[0] as FieldId },
          other.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_field" });
      if (!added.ok) throw new Error();
      expect(
        await removeBlackout(
          db,
          { seasonId: w.seasonId, blackoutId: added.value },
          w.actor,
        ),
      ).toEqual({ ok: true, value: undefined });
      expect(
        await removeBlackout(
          db,
          { seasonId: w.seasonId, blackoutId: added.value },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_blackout" });
    });
  });
});
