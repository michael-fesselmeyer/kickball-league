import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_ITEMS, DEFAULT_MOVE_SCRIPT } from "@/domain/gameday/checklist";
import type { GameChecklistItemId, UserId } from "@/domain/ids";
import type { PreparedFile } from "@/lib/books/store-file";
import { auditLog } from "../schema/audit";
import { booksFile } from "../schema/books";
import { fieldCheck, gameChecklistItem } from "../schema/game-day-checklist";
import { volunteerShift, volunteerSignup } from "../schema/volunteer";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  checklistGame,
  dayFields,
  fieldChecksOn,
  isSetupLead,
  moveIssues,
  recordFieldCheck,
  recordMove,
  saveChecklist,
  seasonChecklist,
  setTick,
  setupLeadShifts,
  ticksFor,
} from "./game-day-checklist";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const TZ = "America/New_York";
const DATE = "2026-09-15";
/** EDT wall-clock on Tuesday, Sep 15, 2026. */
const edt = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 15, hour + 4, minute));

/**
 * One Tuesday with two games on Field 2 (ending 7 pm and 8 pm) and one on
 * Field 3 (ending 7 pm), and a set-up lead who claimed the day's shift.
 */
async function dayWorld(db: Db) {
  const w = await messagingWorld(db);
  const field3 = await w.addField("Field 3");
  const early = await w.gameEnding(edt(19));
  const late = await w.gameEnding(edt(20));
  const other = await w.gameBetween(w.aces.id, w.bees.id, edt(19), {
    onField: field3,
  });
  const lead = await w.person("setup-lead");
  const shift = required(
    (
      await db
        .insert(volunteerShift)
        .values({
          leagueId: w.leagueId,
          role: "setup_lead",
          seasonId: w.season.id,
          startsAt: edt(17),
          endsAt: edt(18),
          spots: 1,
        })
        .returning({ id: volunteerShift.id })
    )[0],
    "shift",
  );
  await db
    .insert(volunteerSignup)
    .values({ shiftId: shift.id, userId: lead.userId });
  return { ...w, field3, early, late, other, lead };
}

const photo = (byte: number): PreparedFile => ({
  contentType: "image/webp",
  bytes: Buffer.from([byte, 1, 2, 3]),
  sha256: `sha-${byte}`,
});

describe("a season's checklist", () => {
  it("starts from the defaults, written once even when read twice at once", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const [a, b] = await Promise.all([
        seasonChecklist(db, w.season.id),
        seasonChecklist(db, w.season.id),
      ]);
      expect(a.items.before.map((i) => i.text)).toEqual(DEFAULT_ITEMS.before);
      expect(a.items.after.map((i) => i.text)).toEqual(DEFAULT_ITEMS.after);
      expect(a.script).toBe(DEFAULT_MOVE_SCRIPT);
      expect(a.custom).toBe(false);
      expect(b.items).toEqual(a.items);
      const rows = await db
        .select()
        .from(gameChecklistItem)
        .where(eq(gameChecklistItem.seasonId, w.season.id));
      expect(rows).toHaveLength(
        DEFAULT_ITEMS.before.length + DEFAULT_ITEMS.after.length,
      );
    }));

  it("saves an admin's edit, keeping the ids (and ticks) of items that stay", () =>
    inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const admin = await w.person("admin");
      const before = await seasonChecklist(db, w.season.id);
      const kept = required(before.items.after[0], "item");
      const dropped = required(before.items.before[0], "item");
      const g = required(await checklistGame(db, w.early.gameId), "game");
      for (const item of [kept, dropped])
        await setTick(db, {
          game: g,
          teamSeasonId: w.aces.id,
          itemId: item.id,
          on: true,
          actorId: w.aces.captain.userId,
          now: edt(18),
        });

      await saveChecklist(db, {
        seasonId: w.season.id,
        form: {
          items: { before: ["Cones out"], after: ["Bases back", kept.text] },
          script: "Hi! We have this field from 6.",
        },
        actorId: admin.userId,
      });
      const after = await seasonChecklist(db, w.season.id);
      expect(after.items.before.map((i) => i.text)).toEqual(["Cones out"]);
      expect(after.items.after.map((i) => i.text)).toEqual([
        "Bases back",
        kept.text,
      ]);
      expect(after.items.after[1]?.id).toBe(kept.id);
      expect(after.script).toBe("Hi! We have this field from 6.");
      expect(after.custom).toBe(true);
      // The removed item took its tick with it; the kept one still has its.
      const ticks = await ticksFor(db, g.id, [w.aces.id]);
      expect([...(ticks.get(w.aces.id) ?? [])]).toEqual([kept.id]);
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "game_checklist.edit"),
            eq(auditLog.entityId, w.season.id),
          ),
        );
      expect(audit?.actorId).toBe(admin.userId);
    }));
});

describe("a game's checklist", () => {
  it("knows the game's day and whether it is the last on its field", () =>
    inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const early = required(await checklistGame(db, w.early.gameId), "early");
      const late = required(await checklistGame(db, w.late.gameId), "late");
      const other = required(await checklistGame(db, w.other.gameId), "other");
      expect(early.date).toBe(DATE);
      expect(early.timeZone).toBe(TZ);
      expect(early.teams.map((t) => t.name)).toEqual(["Aces", "Bees"]);
      expect(early.teamSeasonIds).toEqual([w.aces.id, w.bees.id]);
      expect(early.lastOnField).toBe(false);
      expect(late.lastOnField).toBe(true);
      expect(other.lastOnField).toBe(true);

      const fields = await dayFields(db, w.season.id, DATE, TZ);
      expect(fields.map((f) => f.fieldName)).toEqual(["Field 2", "Field 3"]);
      expect(fields[0]).toMatchObject({
        firstGameId: w.early.gameId,
        lastGameId: w.late.gameId,
        firstStartsAt: edt(18),
        lastEndsAt: edt(20),
      });
      expect(await dayFields(db, w.season.id, "2026-09-16", TZ)).toEqual([]);
    }));

  it("ticks and unticks per team, and refuses another season's item", () =>
    inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const g = required(await checklistGame(db, w.early.gameId), "game");
      const item = required(
        (await seasonChecklist(db, w.season.id)).items.before[0],
        "item",
      );
      const tick = (on: boolean, itemId = item.id) =>
        setTick(db, {
          game: g,
          teamSeasonId: w.aces.id,
          itemId,
          on,
          actorId: w.aces.captain.userId,
          now: edt(18),
        });
      expect(await tick(true)).toBe("saved");
      expect(await tick(true)).toBe("saved"); // Twice is harmless.
      let ticks = await ticksFor(db, g.id, [w.aces.id, w.bees.id]);
      expect([...(ticks.get(w.aces.id) ?? [])]).toEqual([item.id]);
      expect(ticks.get(w.bees.id)?.size).toBe(0);
      expect(await tick(false)).toBe("saved");
      ticks = await ticksFor(db, g.id, [w.aces.id]);
      expect(ticks.get(w.aces.id)?.size).toBe(0);

      const elsewhere = await messagingWorld(db);
      const foreign = required(
        (await seasonChecklist(db, elsewhere.season.id)).items.before[0],
        "item",
      );
      expect(await tick(true, foreign.id)).toBe("not_item");
      expect(
        await tick(true, "00000000-0000-4000-8000-000000000000" as GameChecklistItemId),
      ).toBe("not_item");
      expect((await ticksFor(db, g.id, [])).size).toBe(0);
    }));
});

describe("the set-up lead", () => {
  it("is whoever claimed the season's set-up lead shift that day", () =>
    inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const ask = (userId: UserId, date = DATE) =>
        isSetupLead(db, { userId, seasonId: w.season.id, date, timeZone: TZ });
      expect(await ask(w.lead.userId)).toBe(true);
      expect(await ask(w.lead.userId, "2026-09-16")).toBe(false);
      expect(await ask(w.aces.captain.userId)).toBe(false);
      const shifts = await setupLeadShifts(db, w.lead.userId, TZ, edt(19));
      expect(shifts).toEqual([]);
      const [shift] = await setupLeadShifts(db, w.lead.userId, TZ, edt(12));
      expect(shift).toMatchObject({
        seasonId: w.season.id,
        leagueId: w.leagueId,
        date: DATE,
      });
    }));

  it("logs park users asked to move; only refusals and complaints reach the admins", () =>
    inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const fieldId = (await dayFields(db, w.season.id, DATE, TZ))[0]?.fieldId;
      if (!fieldId) throw new Error("no field");
      for (const [outcome, minute] of [
        ["fine", 0],
        ["refused", 5],
        ["complaint", 10],
      ] as const)
        await recordMove(db, {
          seasonId: w.season.id,
          fieldId,
          form: { outcome, note: outcome === "fine" ? null : `It was ${outcome}` },
          actorId: w.lead.userId,
          now: edt(17, minute),
        });
      const issues = await moveIssues(db, w.leagueId, edt(12));
      expect(issues.map((i) => [i.outcome, i.note, i.fieldName])).toEqual([
        ["complaint", "It was complaint", "Field 2"],
        ["refused", "It was refused", "Field 2"],
      ]);
      expect(issues[0]?.askedBy).toBeTruthy();
      expect(await moveIssues(db, w.leagueId, edt(18))).toEqual([]);
      const elsewhere = await messagingWorld(db);
      expect(await moveIssues(db, elsewhere.leagueId, edt(12))).toEqual([]);
    }));
});

describe("field checks", () => {
  it("keeps one check per field, day and kind, replacing it and its photo", () =>
    inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const fieldId = (await dayFields(db, w.season.id, DATE, TZ))[0]?.fieldId;
      if (!fieldId) throw new Error("no field");
      const close = (
        form: { status: "ok" | "problem"; note: string | null },
        file: PreparedFile | null,
        now: Date,
      ) =>
        recordFieldCheck(db, {
          seasonId: w.season.id,
          fieldId,
          date: DATE,
          kind: "close",
          form,
          photo: file,
          leagueId: w.leagueId,
          actorId: w.aces.captain.userId,
          now,
        });

      expect(
        (await close({ status: "problem", note: "Glass" }, photo(1), edt(20)))
          .ok,
      ).toBe(true);
      let checks = await fieldChecksOn(db, w.season.id, DATE);
      const first = checks.get(fieldId)?.close;
      expect(first).toMatchObject({ status: "problem", note: "Glass" });
      expect(first?.photoId).toBeTruthy();
      expect(checks.get(fieldId)?.setup).toBeNull();

      // Saved again without a photo: the photo stays.
      await close({ status: "ok", note: null }, null, edt(20, 10));
      checks = await fieldChecksOn(db, w.season.id, DATE);
      expect(checks.get(fieldId)?.close).toMatchObject({
        status: "ok",
        photoId: first?.photoId,
      });

      // A new photo replaces the old one, which is deleted.
      await close({ status: "ok", note: null }, photo(2), edt(20, 20));
      checks = await fieldChecksOn(db, w.season.id, DATE);
      const replaced = checks.get(fieldId)?.close?.photoId;
      expect(replaced).not.toBe(first?.photoId);
      const files = await db
        .select({ id: booksFile.id, kind: booksFile.kind })
        .from(booksFile)
        .where(eq(booksFile.leagueId, w.leagueId));
      expect(files).toEqual([{ id: replaced, kind: "field_photo" }]);
      const rows = await db
        .select()
        .from(fieldCheck)
        .where(eq(fieldCheck.fieldId, fieldId));
      expect(rows).toHaveLength(1);

      // Set-up is its own check.
      await recordFieldCheck(db, {
        seasonId: w.season.id,
        fieldId,
        date: DATE,
        kind: "setup",
        form: { status: "ok", note: null },
        photo: null,
        leagueId: w.leagueId,
        actorId: w.lead.userId,
        now: edt(17, 30),
      });
      checks = await fieldChecksOn(db, w.season.id, DATE);
      expect(checks.get(fieldId)?.setup).toMatchObject({ status: "ok" });
      expect(await fieldChecksOn(db, w.season.id, "2026-09-16")).toEqual(
        new Map(),
      );
    }));

  it("refuses a photo once the league's file storage is full", () =>
    inRolledBackDb(async (db) => {
      const w = await dayWorld(db);
      const fieldId = (await dayFields(db, w.season.id, DATE, TZ))[0]?.fieldId;
      if (!fieldId) throw new Error("no field");
      const big: PreparedFile = {
        contentType: "image/webp",
        bytes: Buffer.alloc(100),
        sha256: "big",
      };
      const saved = await recordFieldCheck(db, {
        cap: 50,
        seasonId: w.season.id,
        fieldId,
        date: DATE,
        kind: "close",
        form: { status: "ok", note: null },
        photo: big,
        leagueId: w.leagueId,
        actorId: w.lead.userId,
        now: edt(20),
      });
      expect(saved).toEqual({ ok: false, error: "storage_full" });
      expect((await fieldChecksOn(db, w.season.id, DATE)).size).toBe(0);
    }));
});
