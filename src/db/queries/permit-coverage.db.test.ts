import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { FieldId, PermitWindowId } from "@/domain/ids";
import { booksFile } from "../schema/books";
import { event } from "../schema/event";
import { message } from "../schema/message";
import { permitWindow } from "../schema/schedule";
import { grantRole } from "../test/leagues";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  checkCoverage,
  leagueFields,
  schedulerPermits,
  tellOwnersOfNewGaps,
  uncoveredItems,
  uncoveredKeys,
} from "./permit-coverage";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const TZ = "America/New_York";
/** EDT wall-clock on Tuesday, Sep 15, 2026. */
const edt = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 15, hour + 4, minute));
const NOW = edt(9);

/**
 * Two games on Field 2 (6 to 7 pm and 7 to 8 pm), a permit window from 6 to
 * 7:30 pm with its document, and an owner to tell.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  // The world's one field, "Field 2".
  const fieldId = (await leagueFields(db, w.leagueId))[0]?.id as FieldId;
  const early = await w.gameEnding(edt(19));
  const late = await w.gameEnding(edt(20));
  const [file] = await db
    .insert(booksFile)
    .values({
      leagueId: w.leagueId,
      kind: "permit",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4"),
      byteSize: 8,
      sha256: `permit-${w.tag}`,
    })
    .returning({ id: booksFile.id });
  const window = required(
    (
      await db
        .insert(permitWindow)
        .values({
          fieldId,
          seasonId: w.season.id,
          startsAt: edt(18),
          endsAt: edt(19, 30),
          status: "confirmed",
          documentFileId: file?.id ?? null,
        })
        .returning({ id: permitWindow.id })
    )[0],
    "window",
  );
  const owner = await w.person("owner");
  await grantRole(db, owner.userId, "owner", w.leagueId);
  return { ...w, fieldId, early, late, windowId: window.id, owner };
}

const setWindow = (
  db: Db,
  id: PermitWindowId,
  set: Partial<typeof permitWindow.$inferInsert>,
) => db.update(permitWindow).set(set).where(eq(permitWindow.id, id));

describe("uncoveredItems", () => {
  it("lists the game that runs past the permit, with the gap in words", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const items = await uncoveredItems(db, w.leagueId, NOW);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        key: `game:${w.late.gameId}`,
        kind: "game",
        title: "Aces vs Bees",
        place: expect.stringContaining("Field 2"),
        gap: { kind: "ends_late" },
        sentence:
          "Field 2 is permitted until 7:30 PM; this game ends at 8:00 PM.",
        path: `/app/admin/seasons/${w.season.slug}/schedule`,
      });
      // Played games are not judged.
      expect(await uncoveredItems(db, w.leagueId, edt(21))).toEqual([]);
    }));

  it("counts a window only with its document and not lost", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await setWindow(db, w.windowId, { documentFileId: null });
      let items = await uncoveredItems(db, w.leagueId, NOW);
      expect(items.map((i) => i.gap.kind)).toEqual([
        "no_document",
        "no_document",
      ]);
      // A lost permit is lost, document or not.
      await setWindow(db, w.windowId, { status: "lost" });
      items = await uncoveredItems(db, w.leagueId, NOW);
      expect(items.map((i) => i.gap.kind)).toEqual(["lost", "lost"]);
      const [file] = await db
        .select({ id: booksFile.id })
        .from(booksFile)
        .where(eq(booksFile.leagueId, w.leagueId));
      await setWindow(db, w.windowId, { documentFileId: file?.id ?? null });
      items = await uncoveredItems(db, w.leagueId, NOW);
      expect(items.map((i) => i.gap.kind)).toEqual(["lost", "lost"]);
    }));

  it("judges events on a field, but not open play or called-off ones", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const post = (slug: string, extra: Partial<typeof event.$inferInsert>) =>
        db.insert(event).values({
          leagueId: w.leagueId,
          kind: "pickup",
          title: slug,
          slug: `${slug}-${w.tag}`,
          place: "Example Park",
          startsAt: edt(18),
          endsAt: edt(19),
          fieldId: w.fieldId,
          ...extra,
        });
      await post("covered", {});
      await post("too-early", { startsAt: edt(17), endsAt: edt(18, 30) });
      await post("open-play", {
        startsAt: edt(12),
        endsAt: edt(13),
        openPlay: true,
      });
      await post("called-off", {
        startsAt: edt(12),
        endsAt: edt(13),
        cancelledAt: NOW,
      });
      await post("not-on-a-field", {
        startsAt: edt(12),
        endsAt: edt(13),
        fieldId: null,
        kind: "party",
      });
      const items = await uncoveredItems(db, w.leagueId, NOW);
      expect(items.map((i) => [i.kind, i.title, i.gap.kind])).toEqual([
        ["event", "too-early", "starts_early"],
        ["game", "Aces vs Bees", "ends_late"],
      ]);
      expect(items[0]?.sentence).toBe(
        "Field 2 is permitted from 6:00 PM; this event starts at 5:00 PM.",
      );
      expect(items[0]?.path).toBe(`/app/admin/events/too-early-${w.tag}`);
    }));
});

describe("checkCoverage", () => {
  it("passes inside the permit and explains a gap outside it", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const check = (startsAt: Date, endsAt: Date, fieldId = w.fieldId) =>
        checkCoverage(db, {
          leagueId: w.leagueId,
          fieldId,
          startsAt,
          endsAt,
          noun: "pickup",
          timeZone: TZ,
        });
      expect(await check(edt(18), edt(19))).toEqual({ ok: true });
      expect(await check(edt(19), edt(20))).toMatchObject({
        ok: false,
        reason: "gap",
        sentence:
          "Field 2 is permitted until 7:30 PM; this pickup ends at 8:00 PM.",
      });
      // Another league's field is not this league's to post on.
      const other = await messagingWorld(db);
      const theirs = (await leagueFields(db, other.leagueId))[0]?.id as FieldId;
      expect(await check(edt(18), edt(19), theirs)).toEqual({
        ok: false,
        reason: "unknown_field",
      });
    }));
});

describe("schedulerPermits", () => {
  it("gives H12 the season's fields, their windows and names", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const permits = await schedulerPermits(db, w.season.id, NOW);
      expect(permits.from).toBe(NOW.toISOString());
      expect(permits.timeZone).toBe(TZ);
      expect(permits.fieldNames[w.fieldId]).toBe("Field 2");
      expect(permits.windows).toEqual([
        {
          fieldId: w.fieldId,
          startsAt: edt(18),
          endsAt: edt(19, 30),
          status: "confirmed",
          hasDocument: true,
        },
      ]);
    }));
});

describe("tellOwnersOfNewGaps", () => {
  it("emails the owners once about what newly lost its cover", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const before = await uncoveredKeys(db, w.leagueId, NOW);
      expect([...before]).toEqual([`game:${w.late.gameId}`]);
      // Nothing changed: nothing to tell.
      expect(
        await tellOwnersOfNewGaps(db, {
          leagueId: w.leagueId,
          before,
          now: NOW,
        }),
      ).toBe(0);

      await setWindow(db, w.windowId, { status: "lost" });
      expect(
        await tellOwnersOfNewGaps(db, {
          leagueId: w.leagueId,
          before,
          now: NOW,
        }),
      ).toBe(1);
      const sent = await db
        .select({ payload: message.payload, userId: message.userId })
        .from(message)
        .where(
          and(
            eq(message.template, "permit_alert"),
            eq(message.userId, w.owner.userId),
          ),
        );
      expect(sent).toHaveLength(1);
      expect(sent[0]?.payload).toMatchObject({
        kind: "uncovered",
        count: 1,
        items: [
          {
            what: "Aces vs Bees",
            why: "Field 2's permit for that time was marked lost.",
          },
        ],
      });
      // The same change told again is the same email, not a second one.
      await tellOwnersOfNewGaps(db, { leagueId: w.leagueId, before, now: NOW });
      const again = await db
        .select({ id: message.id })
        .from(message)
        .where(
          and(
            eq(message.template, "permit_alert"),
            eq(message.userId, w.owner.userId),
          ),
        );
      expect(again).toHaveLength(1);
    }));
});
