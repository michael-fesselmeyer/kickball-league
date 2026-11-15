import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { FieldId, LeagueId } from "@/domain/ids";
import { overlapWarnings } from "@/domain/field-groups/groups";
import { zonedInstant } from "@/domain/time/zoned";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { fieldGroup } from "../schema/field-groups";
import { slot } from "../schema/game";
import { league } from "../schema/league";
import { blackout } from "../schema/schedule";
import { season } from "../schema/season";
import { closePool, inRolledBackDb } from "../test/transaction";
import { addField, addPermitWindows, addVenue, syncSlots } from "./fields";
import {
  addGroup,
  addOverlap,
  groupsScreen,
  handoverInputs,
  overlapDays,
  removeGroup,
  removeOverlap,
  updateGroup,
} from "./field-groups";
import type { Db } from "./schedule";

afterAll(closePool);

const NY = "America/New_York";
const MONDAY = "2027-04-05";
const at = (date: string, time: string) => zonedInstant(date, time, NY);

const group = {
  name: "Evening Softball",
  weekdays: [1],
  startsAt: "22:00",
  endsAt: "23:30",
  contact: "555-0100",
};

/** A league with one field and a Monday 8–10 pm permit on it. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `groups-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `groups-${tag}` })
    .returning({ id: league.id });
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
      name: "Spring",
      slug: "spring",
      startsOn: MONDAY,
      endsOn: "2027-06-28",
      feeModel: "per_team",
      teamFeeCents: 100000,
      rosterMin: 12,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  const actor = admin!.id;
  const venue = await addVenue(db, { leagueId: lg!.id, name: "Park" }, actor);
  if (!venue.ok) throw new Error(venue.error);
  const f = await addField(
    db,
    { leagueId: lg!.id, venueId: venue.value, name: "Field 1" },
    actor,
  );
  if (!f.ok) throw new Error(f.error);
  await addPermitWindows(
    db,
    {
      leagueId: lg!.id,
      seasonId: sn!.id,
      fieldId: f.value,
      dates: [MONDAY, "2027-04-12"],
      startTime: "20:00",
      endTime: "22:00",
      timeZone: NY,
      status: "confirmed",
    },
    actor,
  );
  return { actor, leagueId: lg!.id, seasonId: sn!.id, fieldId: f.value };
}

async function withGroup(db: Db) {
  const w = await world(db);
  const g = await addGroup(
    db,
    { leagueId: w.leagueId, fieldId: w.fieldId, group },
    w.actor,
  );
  if (!g.ok) throw new Error(g.error);
  return { ...w, groupId: g.value };
}

describe("groups on a field", () => {
  it("adds, edits and removes a group, and audits it without the contact", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      let screen = await groupsScreen(db, w.leagueId);
      expect(screen.groups).toHaveLength(1);
      expect(screen.groups[0]).toMatchObject({
        name: "Evening Softball",
        weekdays: [1],
        startsAt: "22:00",
        endsAt: "23:30",
        contact: "555-0100",
        fieldLabel: "Field 1",
        venueName: "Park",
      });

      expect(
        await updateGroup(
          db,
          {
            leagueId: w.leagueId,
            groupId: w.groupId,
            group: {
              ...group,
              weekdays: [],
              startsAt: null,
              endsAt: null,
              contact: null,
            },
          },
          w.actor,
        ),
      ).toEqual({ ok: true, value: undefined });
      screen = await groupsScreen(db, w.leagueId);
      expect(screen.groups[0]).toMatchObject({
        weekdays: [],
        startsAt: null,
        contact: null,
      });

      expect(
        await removeGroup(
          db,
          { leagueId: w.leagueId, groupId: w.groupId },
          w.actor,
        ),
      ).toEqual({ ok: true, value: undefined });
      expect((await groupsScreen(db, w.leagueId)).groups).toEqual([]);

      const log = await db.select().from(auditLog);
      const mine = log.filter((l) => l.action.startsWith("field_group."));
      expect(mine.map((l) => l.action).sort()).toEqual([
        "field_group.create",
        "field_group.delete",
        "field_group.update",
      ]);
      expect(JSON.stringify(mine)).not.toContain("555-0100");
    });
  });

  it("keeps another league's fields and groups out of reach", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      const other = await world(db);
      expect(
        await addGroup(
          db,
          { leagueId: other.leagueId, fieldId: w.fieldId, group },
          other.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_field" });
      expect(
        await updateGroup(
          db,
          { leagueId: other.leagueId, groupId: w.groupId, group },
          other.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_group" });
      expect(
        await removeGroup(
          db,
          { leagueId: other.leagueId, groupId: w.groupId },
          other.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_group" });
      expect((await groupsScreen(db, other.leagueId)).groups).toEqual([]);
      expect(await db.select().from(fieldGroup)).toHaveLength(1);
    });
  });

  it("refuses hours the table would reject", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await expect(
        db.transaction((tx) =>
          tx.insert(fieldGroup).values({
            fieldId: w.fieldId,
            name: "Bad",
            weekdays: [1],
            startsAt: "22:00",
            endsAt: null,
          }),
        ),
      ).rejects.toThrow();
    });
  });
});

describe("recorded overlaps", () => {
  it("records one per group and day, and removes it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      const first = await addOverlap(
        db,
        {
          leagueId: w.leagueId,
          groupId: w.groupId,
          on: MONDAY,
          note: " both hold 9 pm ",
        },
        w.actor,
      );
      expect(first.ok).toBe(true);
      expect(
        await addOverlap(
          db,
          { leagueId: w.leagueId, groupId: w.groupId, on: MONDAY, note: "" },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "duplicate" });
      expect(
        await addOverlap(
          db,
          {
            leagueId: w.leagueId,
            groupId: w.groupId,
            on: "2027-02-30",
            note: "",
          },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "bad_date" });
      expect(
        await addOverlap(
          db,
          {
            leagueId: w.leagueId,
            groupId: w.groupId,
            on: "2027-04-12",
            note: "x".repeat(301),
          },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "bad_note" });
      const screen = await groupsScreen(db, w.leagueId);
      expect(screen.overlaps).toEqual([
        expect.objectContaining({
          on: MONDAY,
          note: "both hold 9 pm",
          group: "Evening Softball",
        }),
      ]);
      if (!first.ok) return;
      expect(
        await removeOverlap(
          db,
          { leagueId: w.leagueId, overlapId: first.value },
          w.actor,
        ),
      ).toEqual({ ok: true, value: undefined });
      expect((await groupsScreen(db, w.leagueId)).overlaps).toEqual([]);
    });
  });

  it("goes away with its group", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      await addOverlap(
        db,
        { leagueId: w.leagueId, groupId: w.groupId, on: MONDAY, note: "" },
        w.actor,
      );
      await removeGroup(
        db,
        { leagueId: w.leagueId, groupId: w.groupId },
        w.actor,
      );
      expect((await groupsScreen(db, w.leagueId)).overlaps).toEqual([]);
    });
  });

  it("tells a day still needed from a rained-out, blacked-out or lost one", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      for (const on of [MONDAY, "2027-04-12", "2027-04-19"])
        await addOverlap(
          db,
          { leagueId: w.leagueId, groupId: w.groupId, on, note: "" },
          w.actor,
        );
      await syncSlots(
        db,
        { seasonId: w.seasonId, slotMinutes: 60, timeZone: NY },
        w.actor,
      );
      // 2027-04-05: every slot cancelled. 2027-04-12: blacked out.
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.startsAt, at(MONDAY, "20:00")));
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.startsAt, at(MONDAY, "21:00")));
      await db.insert(blackout).values({
        seasonId: w.seasonId,
        onDate: "2027-04-12",
        fieldId: null,
      });
      const { overlaps } = await groupsScreen(db, w.leagueId);
      const days = await overlapDays(db, { overlaps, timeZone: NY });
      const warnings = overlapWarnings({
        overlaps,
        today: "2027-04-01",
        ...days,
      });
      expect(warnings.map((x) => [x.on, x.reason])).toEqual([
        [MONDAY, "rained_out"],
        ["2027-04-12", "blackout"],
        ["2027-04-19", "no_permit"],
      ]);
    });
  });
});

describe("handoverInputs", () => {
  const input = (
    w: { leagueId: LeagueId; fieldId: FieldId },
    date = MONDAY,
  ) => ({
    leagueId: w.leagueId,
    fieldIds: [w.fieldId],
    date,
    timeZone: NY,
  });

  it("gives the field's groups and the league's permit hold for the day", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      const [found] = await handoverInputs(db, input(w));
      expect(found?.fieldId).toBe(w.fieldId);
      expect(found?.groups.map((g) => g.name)).toEqual(["Evening Softball"]);
      expect(found?.ours).toEqual({
        start: at(MONDAY, "20:00"),
        end: at(MONDAY, "22:00"),
      });
    });
  });

  it("leaves out a day with no permit, a lost permit and a rained-out field", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      expect(await handoverInputs(db, input(w, "2027-04-06"))).toEqual([]);
      await syncSlots(
        db,
        { seasonId: w.seasonId, slotMinutes: 60, timeZone: NY },
        w.actor,
      );
      await db.update(slot).set({ status: "cancelled" });
      expect(await handoverInputs(db, input(w))).toEqual([]);
    });
  });

  it("leaves out a field no group uses", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await handoverInputs(db, input(w))).toEqual([]);
    });
  });

  it("finds the hold by local day across the clocks changing", async () => {
    await inRolledBackDb(async (db) => {
      const w = await withGroup(db);
      await addPermitWindows(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.seasonId,
          fieldId: w.fieldId,
          dates: ["2027-03-14"],
          startTime: "20:00",
          endTime: "22:00",
          timeZone: NY,
          status: "confirmed",
        },
        w.actor,
      );
      const [found] = await handoverInputs(db, input(w, "2027-03-14"));
      expect(found?.ours.start).toEqual(at("2027-03-14", "20:00"));
    });
  });
});
