import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { FieldId, GameId, SeasonId } from "@/domain/ids";
import { field, game, scoreReport, slot } from "../schema/game";
import { gameDayStatus, gameDayStatusGame } from "../schema/game-day";
import { message } from "../schema/message";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { setFieldLights } from "./fields";
import {
  queueStartReminders,
  recordStart,
  seasonStarts,
  setHeldUpBy,
  startOf,
  undoStart,
} from "./game-start";
import { permitInfoFor } from "./permit-watch";
import type { Db } from "./schedule";
import { slotsPastDaylight } from "./schedule-screen";
import { reportScore } from "./scores";

afterAll(closePool);

/**
 * Tuesday 6 October 2026 in New York: a 6 to 7 pm EDT slot (22:00 to 23:00
 * UTC). Sunset is about 6:35 pm, so on a field without lights play must end
 * about 6:20 pm: a late start comes straight out of the game.
 */
const SLOT_ENDS = new Date("2026-10-06T23:00:00Z");
const FIRST_PITCH = new Date("2026-10-06T22:00:00Z");
const at = (minutesFromFirstPitch: number) =>
  new Date(FIRST_PITCH.getTime() + minutesFromFirstPitch * 60_000);

const nudges = async (db: Db) =>
  db
    .select({
      userId: message.userId,
      key: message.dedupeKey,
      sendAfter: message.sendAfter,
      payload: message.payload,
    })
    .from(message)
    .where(like(message.dedupeKey, "start-on-time/%"));

async function litField(
  db: Db,
  w: Awaited<ReturnType<typeof messagingWorld>>,
  name: string,
): Promise<FieldId> {
  const id = await w.addField(name);
  await db.update(field).set({ hasLights: true }).where(eq(field.id, id));
  return id;
}

/** A game-day status (#383) for 6 October touching one game. */
async function dayStatus(
  db: Db,
  seasonId: SeasonId,
  gameId: GameId,
  state: "delayed" | "off",
  newStartsAt: Date | null = null,
) {
  const [status] = await db
    .insert(gameDayStatus)
    .values({ seasonId, date: "2026-10-06", state })
    .returning({ id: gameDayStatus.id });
  if (!status) throw new Error("no status");
  await db
    .insert(gameDayStatusGame)
    .values({ statusId: status.id, gameId, newStartsAt });
}

describe("recording first pitch", () => {
  it("takes one tap from half an hour before, keeps the first tap, and undoes", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(SLOT_ENDS, ref.userId);
      const tap = (now: Date) =>
        recordStart(db, { gameId, userId: ref.userId, now });

      expect(await tap(at(-31))).toEqual({ ok: false, error: "too_early" });
      expect(await startOf(db, gameId)).toBeNull();
      expect(await tap(at(-25))).toEqual({ ok: true, value: at(-25) });
      // A double tap, or a resend, keeps the first time.
      expect(await tap(at(8))).toEqual({ ok: true, value: at(-25) });

      expect(await undoStart(db, { gameId, now: at(9) })).toEqual({
        ok: true,
        value: true,
      });
      expect(await startOf(db, gameId)).toBeNull();
      expect(await tap(at(12))).toEqual({ ok: true, value: at(12) });

      expect(
        await setHeldUpBy(db, {
          gameId,
          heldUpBy: "team_b",
          userId: ref.userId,
          now: at(13),
        }),
      ).toEqual({ ok: true, value: true });
      expect(await startOf(db, gameId)).toEqual({
        startedAt: at(12),
        heldUpBy: "team_b",
      });
      // The clock reads it too.
      expect((await permitInfoFor(db, [gameId])).get(gameId)).toMatchObject({
        startedAt: at(12),
        heldUpBy: "team_b",
        end: { reason: "daylight" },
      });
    }));

  it("refuses a closed game, and who held up a game not started", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(SLOT_ENDS, ref.userId);
      expect(
        await setHeldUpBy(db, {
          gameId,
          heldUpBy: "neither",
          userId: ref.userId,
          now: at(5),
        }),
      ).toEqual({ ok: false, error: "not_started" });
      await recordStart(db, { gameId, userId: ref.userId, now: at(1) });
      await db
        .update(game)
        .set({ status: "cancelled" })
        .where(eq(game.id, gameId));
      expect(
        await recordStart(db, { gameId, userId: ref.userId, now: at(2) }),
      ).toEqual({ ok: false, error: "closed" });
      expect(await undoStart(db, { gameId, now: at(2) })).toEqual({
        ok: false,
        error: "closed",
      });
      expect(await startOf(db, gameId)).not.toBeNull();
    }));
});

describe("seasonStarts", () => {
  it("sums each team's late starts and lists every start", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const cats = await w.entry("Cats");
      const first = await w.gameEnding(SLOT_ENDS, ref.userId);
      const second = await w.gameBetween(
        w.aces.id,
        cats,
        new Date(SLOT_ENDS.getTime() + 7 * 86_400_000),
      );
      const third = await w.gameBetween(
        w.bees.id,
        cats,
        new Date(SLOT_ENDS.getTime() + 14 * 86_400_000),
      );
      const start = async (
        gameId: typeof first.gameId,
        late: number,
        heldUpBy: "team_a" | "team_b" | "both" | null,
        week: number,
      ) => {
        const now = new Date(at(late).getTime() + week * 7 * 86_400_000);
        await recordStart(db, { gameId, userId: ref.userId, now });
        if (heldUpBy)
          await setHeldUpBy(db, { gameId, heldUpBy, userId: ref.userId, now });
      };
      await start(first.gameId, 14, "team_a", 0); // Aces 14 late
      await start(second.gameId, 3, "team_a", 1); // in the grace
      await start(third.gameId, 20, "both", 2); // Bees and Cats 20 late

      const { teams, starts } = await seasonStarts(db, w.season.id);
      expect(starts.map((s) => s.gameId)).toEqual([
        first.gameId,
        second.gameId,
        third.gameId,
      ]);
      expect(starts[0]).toMatchObject({
        teamA: "Aces",
        teamB: "Bees",
        firstPitchAt: FIRST_PITCH,
        startedAt: at(14),
        heldUpBy: "team_a",
      });
      expect(
        teams.map((t) => [t.teamName, t.starts, t.lateStarts, t.minutesLost]),
      ).toEqual([
        ["Bees", 2, 1, 20],
        ["Cats", 2, 1, 20],
        ["Aces", 2, 1, 14],
      ]);
    }));

  it("is empty for a season with no starts recorded", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      await w.gameEnding(SLOT_ENDS);
      expect(await seasonStarts(db, w.season.id)).toEqual({
        teams: [],
        starts: [],
      });
    }));
});

describe("queueStartReminders", () => {
  // 7 pm EDT the evening before.
  const EVENING_BEFORE = new Date("2026-10-05T23:00:00Z");

  it("nudges the captains and the ref of tomorrow's tight game, two hours before, once", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(SLOT_ENDS, ref.userId);

      expect(await queueStartReminders(db, EVENING_BEFORE)).toBe(3);
      expect(await queueStartReminders(db, EVENING_BEFORE)).toBe(0);
      const queued = await nudges(db);
      expect(queued.map((m) => m.userId).sort()).toEqual(
        [ref.userId, w.aces.captain.userId, w.bees.captain.userId].sort(),
      );
      for (const m of queued) {
        expect(m.key).toBe(`start-on-time/${gameId}/${m.userId}`);
        expect(m.sendAfter).toEqual(at(-120));
      }
      const refNudge = queued.find((m) => m.userId === ref.userId);
      expect(refNudge?.payload).toMatchObject({
        gameId,
        teams: "Aces vs Bees",
        place: "Park, Field 2",
        startsAt: FIRST_PITCH.toISOString(),
        endReason: "daylight",
        role: "referee",
        timeZone: "America/New_York",
      });
    }));

  it("leaves out games with time to spare, games not tomorrow and games off", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      // A morning game: daylight lasts long after it.
      await w.gameEnding(new Date("2026-10-06T15:00:00Z"));
      // A lit field with no permit: nothing ends it early.
      await w.gameBetween(w.aces.id, w.bees.id, SLOT_ENDS, {
        onField: await litField(db, w, "Field 9"),
      });
      // The same tight time, two days out.
      await w.gameEnding(new Date(SLOT_ENDS.getTime() + 86_400_000));
      // Tomorrow and tight, but rained out.
      const off = await w.gameBetween(w.aces.id, w.bees.id, SLOT_ENDS, {
        onField: await w.addField("Field 3"),
      });
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.id, off.slotId));
      expect(await queueStartReminders(db, EVENING_BEFORE)).toBe(0);
    }));
});

describe("why a called game ended", () => {
  it("keeps the reason on a called score, and never on a normal one", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(SLOT_ENDS, ref.userId);
      const report = (outcome: "called" | "normal", clientId: string) =>
        reportScore(db, {
          gameId,
          userId: ref.userId,
          role: "referee",
          teamSeasonId: null,
          score: {
            outcome,
            scoreA: 4,
            scoreB: 2,
            inningsPlayed: outcome === "called" ? 4 : null,
            callReason: "daylight",
          },
          clientId: `${clientId}-${w.tag}`,
          now: at(30),
        });
      expect((await report("called", "first")).ok).toBe(true);
      expect((await report("normal", "second")).ok).toBe(true);
      const rows = await db
        .select({ outcome: scoreReport.outcome, why: scoreReport.callReason })
        .from(scoreReport)
        .where(eq(scoreReport.gameId, gameId));
      expect(rows.sort((a, b) => a.outcome.localeCompare(b.outcome))).toEqual([
        { outcome: "called", why: "daylight" },
        { outcome: "normal", why: null },
      ]);
    }));

  it("refuses a reason on a score that was not called", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(SLOT_ENDS, ref.userId);
      await expect(
        db.insert(scoreReport).values({
          gameId,
          reportedBy: ref.userId,
          reporterRole: "referee",
          scoreA: 1,
          scoreB: 0,
          outcome: "normal",
          callReason: "field_time",
          clientId: `bad-${w.tag}`,
        }),
      ).rejects.toThrow();
    }));
});

describe("field lights", () => {
  it("lets an admin mark a field lit, which takes sunset out of its games", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId, slotId } = await w.gameEnding(SLOT_ENDS, ref.userId);
      const [row] = await db
        .select({ fieldId: slot.fieldId })
        .from(slot)
        .where(eq(slot.id, slotId));
      const fieldId = row?.fieldId as FieldId;
      expect(
        (await permitInfoFor(db, [gameId])).get(gameId)?.sunsetAt,
      ).toBeInstanceOf(Date);
      expect(
        await slotsPastDaylight(db, w.season.id, "America/New_York"),
      ).toHaveProperty("size", 1);

      expect(
        await setFieldLights(
          db,
          { leagueId: w.leagueId, fieldId, hasLights: true },
          ref.userId,
        ),
      ).toEqual({ ok: true, value: fieldId });
      // A lit field with no permit window has no end of play at all.
      expect((await permitInfoFor(db, [gameId])).has(gameId)).toBe(false);
      expect(
        (await slotsPastDaylight(db, w.season.id, "America/New_York")).size,
      ).toBe(0);
    }));

  it("refuses a field from another league", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const other = await messagingWorld(db);
      const ref = await w.person("ref");
      const theirs = await other.addField("Their field");
      expect(
        await setFieldLights(
          db,
          { leagueId: w.leagueId, fieldId: theirs, hasLights: true },
          ref.userId,
        ),
      ).toEqual({ ok: false, error: "unknown_field" });
      const [f] = await db
        .select({ hasLights: field.hasLights })
        .from(field)
        .where(and(eq(field.id, theirs)));
      expect(f?.hasLights).toBe(false);
    }));
});

describe("slotsPastDaylight", () => {
  it("warns about a fall evening slot, not a morning one or a cancelled one", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const late = await w.gameEnding(SLOT_ENDS);
      await w.gameEnding(new Date("2026-10-06T15:00:00Z"));
      const off = await w.gameEnding(
        new Date(SLOT_ENDS.getTime() + 86_400_000),
      );
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.id, off.slotId));
      const risks = await slotsPastDaylight(
        db,
        w.season.id,
        "America/New_York",
      );
      expect([...risks.keys()]).toEqual([late.slotId]);
      // Sunset about 6:35 pm less 15 minutes is about 6:20 pm: the slot runs
      // about 40 minutes past it.
      const short = risks.get(late.slotId)?.minutesShort ?? 0;
      expect(short).toBeGreaterThan(35);
      expect(short).toBeLessThan(45);
    }));
});

describe("a delayed or called-off game day", () => {
  const EVENING_BEFORE = new Date("2026-10-05T23:00:00Z");

  it("moves first pitch, the nudge and lateness to the delayed start", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      // A noon game pushed back to 5:45 pm EDT, close to dusk.
      const { gameId } = await w.gameEnding(
        new Date("2026-10-06T17:00:00Z"),
        ref.userId,
      );
      const delayedTo = new Date("2026-10-06T21:45:00Z");
      await dayStatus(db, w.season.id, gameId, "delayed", delayedTo);
      const info = (await permitInfoFor(db, [gameId])).get(gameId);
      expect(info?.clockStartsAt).toEqual(delayedTo);
      expect(info?.dayOff).toBe(false);

      // At noon it had time to spare; at 5:45 pm it has none.
      expect(await queueStartReminders(db, EVENING_BEFORE)).toBe(3);
      for (const m of await nudges(db)) {
        expect(m.sendAfter).toEqual(new Date("2026-10-06T19:45:00Z"));
        expect(m.payload).toMatchObject({ startsAt: delayedTo.toISOString() });
      }

      // Three minutes after the delayed start is on time.
      await recordStart(db, {
        gameId,
        userId: ref.userId,
        now: new Date(delayedTo.getTime() + 3 * 60_000),
      });
      const { teams, starts } = await seasonStarts(db, w.season.id);
      expect(starts[0]?.firstPitchAt).toEqual(delayedTo);
      expect(teams.every((t) => t.lateStarts === 0)).toBe(true);
    }));

  it("shows no clock and sends no nudge for a game that is off", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(SLOT_ENDS, ref.userId);
      await dayStatus(db, w.season.id, gameId, "off");
      expect((await permitInfoFor(db, [gameId])).get(gameId)?.dayOff).toBe(
        true,
      );
      expect(await queueStartReminders(db, EVENING_BEFORE)).toBe(0);
    }));
});
