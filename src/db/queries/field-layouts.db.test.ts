import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { user } from "../schema/auth";
import { booksFile } from "../schema/books";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  fieldsWithLayouts,
  layoutFileForGame,
  layoutForGame,
  layoutsOf,
  setFieldLayout,
  setupFields,
} from "./field-layouts";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const one = <T>(rows: T[], what: string) => required(rows[0], what);

const file = (n: number) => ({
  contentType: "image/webp" as const,
  bytes: Buffer.from(`layout-${n}`),
  sha256: `hash-${n}`,
});

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const admin = one(
    await db
      .insert(user)
      .values({ name: "Admin", email: `fl-${tag}@example.test` })
      .returning({ id: user.id }),
    "user",
  ).id;
  const lg = one(
    await db
      .insert(league)
      .values({ name: "Test League", slug: `fl-${tag}` })
      .returning({ id: league.id }),
    "league",
  ).id;
  const sn = one(
    await db
      .insert(season)
      .values({
        leagueId: lg,
        name: "Fall",
        slug: `fall-${tag}`,
        status: "in_progress",
        startsOn: "2026-09-01",
        endsOn: "2026-12-01",
        feeModel: "per_player",
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      })
      .returning({ id: season.id }),
    "season",
  ).id;
  const park = one(
    await db
      .insert(venue)
      .values({ leagueId: lg, name: "Example Park", slug: `p-${tag}` })
      .returning({ id: venue.id }),
    "venue",
  ).id;
  const [f1, f2] = (
    await db
      .insert(field)
      .values(["Field 1", "Field 2"].map((name) => ({ venueId: park, name })))
      .returning({ id: field.id })
  ).map((f) => f.id);
  if (!f1 || !f2) throw new Error("no fields");
  return { admin, lg, sn, f1, f2 };
}

describe("setting a field's layout", () => {
  it("stores a file with a note, and a new file replaces and deletes the old", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const first = await setFieldLayout(
        db,
        {
          leagueId: w.lg,
          fieldId: w.f1,
          file: file(1),
          noLayoutNeeded: false,
          note: "Cones at the four corners",
        },
        w.admin,
      );
      expect(first.ok).toBe(true);
      const [a] = await layoutsOf(db, [w.f1]).then((m) => [...m.values()]);
      expect(a).toMatchObject({
        state: "layout",
        note: "Cones at the four corners",
        contentType: "image/webp",
      });
      const oldId = a?.fileId;
      await setFieldLayout(
        db,
        {
          leagueId: w.lg,
          fieldId: w.f1,
          file: file(2),
          noLayoutNeeded: false,
          note: null,
        },
        w.admin,
      );
      const [b] = await layoutsOf(db, [w.f1]).then((m) => [...m.values()]);
      expect(b?.fileId).not.toBe(oldId);
      expect(b?.note).toBeNull();
      expect(
        await db.select().from(booksFile).where(eq(booksFile.id, oldId!)),
      ).toHaveLength(0);
    }));

  it("keeps the file when only the note changes", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const base = { leagueId: w.lg, fieldId: w.f1, noLayoutNeeded: false };
      await setFieldLayout(
        db,
        { ...base, file: file(1), note: "First" },
        w.admin,
      );
      const before = (await layoutsOf(db, [w.f1])).get(w.f1);
      await setFieldLayout(
        db,
        { ...base, file: null, note: "Second" },
        w.admin,
      );
      const after = (await layoutsOf(db, [w.f1])).get(w.f1);
      expect(after?.fileId).toBe(before?.fileId);
      expect(after?.note).toBe("Second");
    }));

  it("takes an admin's word that no layout is needed, and drops the file", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const base = { leagueId: w.lg, fieldId: w.f1, note: null };
      await setFieldLayout(
        db,
        { ...base, file: file(1), noLayoutNeeded: false },
        w.admin,
      );
      await setFieldLayout(
        db,
        { ...base, file: null, noLayoutNeeded: true },
        w.admin,
      );
      const now = (await layoutsOf(db, [w.f1])).get(w.f1);
      expect(now).toMatchObject({ state: "none_needed", fileId: null });
      expect(await db.select().from(booksFile)).toHaveLength(0);
    }));

  it("puts a field back to no answer when 'no layout needed' is unticked", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const base = { leagueId: w.lg, fieldId: w.f1, file: null, note: null };
      await setFieldLayout(db, { ...base, noLayoutNeeded: true }, w.admin);
      await setFieldLayout(db, { ...base, noLayoutNeeded: false }, w.admin);
      expect((await layoutsOf(db, [w.f1])).get(w.f1)?.state).toBe("missing");
    }));

  it("refuses a note for a field with no layout and no answer", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const result = await setFieldLayout(
        db,
        {
          leagueId: w.lg,
          fieldId: w.f1,
          file: null,
          noLayoutNeeded: false,
          note: "Cones",
        },
        w.admin,
      );
      expect(result).toEqual({ ok: false, error: "no_layout" });
    }));

  it("refuses a file when storage is full", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const result = await setFieldLayout(
        db,
        {
          leagueId: w.lg,
          fieldId: w.f1,
          file: file(1),
          noLayoutNeeded: false,
          note: null,
          cap: 3,
        },
        w.admin,
      );
      expect(result).toEqual({ ok: false, error: "storage_full" });
    }));
});

describe("reading layouts", () => {
  it("lists the league's fields with their state", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await setFieldLayout(
        db,
        {
          leagueId: w.lg,
          fieldId: w.f2,
          file: null,
          noLayoutNeeded: true,
          note: null,
        },
        w.admin,
      );
      const rows = await fieldsWithLayouts(db, w.lg);
      expect(rows.map((r) => [r.name, r.state])).toEqual([
        ["Field 1", "missing"],
        ["Field 2", "none_needed"],
      ]);
    }));

  it("finds a game's layout through its slot, and the set-up fields of a day", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const teams = await db
        .insert(team)
        .values(
          ["Aces", "Bees"].map((name) => ({
            leagueId: w.lg,
            name,
            slug: `${name.toLowerCase()}-${w.lg.slice(0, 4)}`,
          })),
        )
        .returning({ id: team.id });
      const [a, b] = (
        await db
          .insert(teamSeason)
          .values(teams.map((t) => ({ teamId: t.id, seasonId: w.sn })))
          .returning({ id: teamSeason.id })
      ).map((t) => t.id);
      const startsAt = new Date("2026-11-14T18:00:00Z");
      const s = one(
        await db
          .insert(slot)
          .values({
            seasonId: w.sn,
            fieldId: w.f1,
            startsAt,
            endsAt: new Date("2026-11-14T19:00:00Z"),
            timeIndex: 0,
          })
          .returning({ id: slot.id }),
        "slot",
      );
      const g = one(
        await db
          .insert(game)
          .values({ seasonId: w.sn, teamAId: a!, teamBId: b!, slotId: s.id })
          .returning({ id: game.id }),
        "game",
      ).id;
      expect(await layoutFileForGame(db, g)).toBeNull();
      await setFieldLayout(
        db,
        {
          leagueId: w.lg,
          fieldId: w.f1,
          file: file(1),
          noLayoutNeeded: false,
          note: "Cones",
        },
        w.admin,
      );
      expect(await layoutForGame(db, g)).toMatchObject({
        fieldName: "Field 1",
        note: "Cones",
        contentType: "image/webp",
      });
      expect((await layoutFileForGame(db, g))?.sha256).toBe("hash-1");
      const day = await setupFields(
        db,
        w.sn,
        new Date("2026-11-14T12:00:00Z"),
        new Date("2026-11-15T00:00:00Z"),
      );
      expect(day.map((f) => [f.name, f.state])).toEqual([
        ["Field 1", "layout"],
      ]);
      expect(
        await setupFields(
          db,
          w.sn,
          new Date("2026-11-15T00:00:00Z"),
          new Date("2026-11-16T00:00:00Z"),
        ),
      ).toEqual([]);
    }));
});
