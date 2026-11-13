import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { GameId, TeamSeasonId, UserId } from "@/domain/ids";
import type {
  OfflineEnd,
  OfflineHalf,
  OfflineScore,
} from "@/domain/scores/offline";
import type { ScoreInput } from "@/domain/scores/scores";
import { scoreVersion } from "@/domain/scores/offline";
import { game, gamePeriod, offlineReceipt, scoreReport } from "../schema/game";
import { message } from "../schema/message";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { enterHalf, setKicksFirst, undoLastHalf } from "./live-scores";
import { applyOfflineEntry } from "./offline-scores";
import { required } from "./rows";
import type { Db } from "./schedule";
import {
  currentScoreState,
  gameForScoring,
  reportScore,
  respondToScore,
} from "./scores";

afterAll(closePool);

const ENDS = new Date("2026-09-14T01:00:00Z");
const after = (minutes: number) => new Date(ENDS.getTime() + minutes * 60_000);

const final: ScoreInput = {
  outcome: "normal",
  scoreA: 7,
  scoreB: 4,
  inningsPlayed: null,
};

async function setUp(db: Db) {
  const w = await messagingWorld(db);
  const { gameId } = await w.gameEnding(ENDS);
  const g = required(await gameForScoring(db, gameId), "game");
  const capA = w.aces.captain.userId;
  const capB = w.bees.captain.userId;

  /** A score typed on Aces' captain's phone while the score showed `version`. */
  const scoreEntry = (version: string, score = final): OfflineScore => ({
    kind: "score",
    key: randomUUID(),
    gameId,
    userId: capA,
    enteredAt: after(-2).toISOString(),
    version,
    score,
  });
  const halfEntry = (
    inning: number,
    half: "top" | "bottom",
    runs: number,
    was: number | null = null,
  ): OfflineHalf => ({
    kind: "half",
    key: randomUUID(),
    gameId,
    userId: capA,
    enteredAt: after(-30).toISOString(),
    inning,
    half,
    runs,
    was,
  });
  const endEntry = (version: string): OfflineEnd => ({
    kind: "end",
    key: randomUUID(),
    gameId,
    userId: capA,
    enteredAt: after(-1).toISOString(),
    version,
    ending: "normal",
  });

  const apply = (
    entry: OfflineScore | OfflineHalf | OfflineEnd,
    {
      userId = capA,
      team = w.aces.id,
      at = after(10),
    }: { userId?: UserId; team?: TeamSeasonId; at?: Date } = {},
  ) =>
    applyOfflineEntry(db, {
      entry,
      g,
      userId,
      role: "captain",
      teamSeasonId: team,
      now: at,
    });

  const reports = () =>
    db
      .select({ id: scoreReport.id, scoreA: scoreReport.scoreA })
      .from(scoreReport)
      .where(eq(scoreReport.gameId, gameId));
  const asked = async () =>
    (
      await db
        .select({ userId: message.userId })
        .from(message)
        .where(like(message.dedupeKey, "score-confirm/%"))
    ).map((r) => r.userId);
  const runsIn = async (inning: number, half: "top" | "bottom") =>
    (
      await db
        .select({ runs: gamePeriod.runs })
        .from(gamePeriod)
        .where(
          and(
            eq(gamePeriod.gameId, gameId),
            eq(gamePeriod.periodNo, inning),
            eq(gamePeriod.half, half),
          ),
        )
    )[0]?.runs ?? null;
  const version = async (at = after(10)) => {
    const { history } = await currentScoreState(db, g, at);
    return scoreVersion(history.reports, history.responses);
  };

  return {
    w,
    g,
    gameId,
    capA,
    capB,
    scoreEntry,
    halfEntry,
    endEntry,
    apply,
    reports,
    asked,
    runsIn,
    version,
  };
}

describe("offline final scores", () => {
  it("saves a score once, and a resend changes nothing and gets the same answer", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      const entry = t.scoreEntry("none");
      const first = await t.apply(entry);
      expect(first).toEqual({
        result: {
          status: "saved",
          message: "Saved: Aces 7, Bees 4. It goes final once it's confirmed.",
        },
        changed: true,
      });
      const again = await t.apply(entry, { at: after(60) });
      expect(again).toEqual({ result: first.result, changed: false });
      expect(await t.reports()).toHaveLength(1);
      // The other captain is asked to confirm it once.
      expect(await t.asked()).toEqual([t.capB]);
      const [receipt] = await db
        .select()
        .from(offlineReceipt)
        .where(eq(offlineReceipt.key, entry.key));
      expect(receipt).toMatchObject({
        userId: t.capA,
        gameId: t.gameId,
        kind: "score",
        result: first.result,
        enteredAt: new Date(entry.enteredAt),
      });
    });
  });

  it("keeps the other captain's score reported while this one waited", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      const entry = t.scoreEntry("none");
      await reportScore(db, {
        gameId: t.gameId,
        userId: t.capB,
        role: "captain",
        teamSeasonId: t.w.bees.id,
        score: { ...final, scoreB: 9 },
        clientId: randomUUID(),
        now: after(5),
      });
      const { result, changed } = await t.apply(entry);
      expect(changed).toBe(false);
      expect(result.status).toBe("kept");
      expect(result.message).toMatch(
        /reported Aces 7, Bees 9 while you were offline, so yours wasn't saved/,
      );
      expect((await t.reports()).map((r) => r.scoreA)).toEqual([7]);
      // A resend gets the same answer, even once the score has moved on.
      expect((await t.apply(entry)).result).toEqual(result);
    });
  });

  it("keeps a score confirmed while this one waited", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      const ref = await t.w.person("ref");
      const reported = await reportScore(db, {
        gameId: t.gameId,
        userId: ref.userId,
        role: "referee",
        teamSeasonId: null,
        score: final,
        clientId: randomUUID(),
        now: after(1),
      });
      if (!reported.ok || reported.value.state !== "awaiting")
        throw new Error("expected an awaiting report");
      // Aces' captain sees the ref's score and types a different one…
      const entry = t.scoreEntry(await t.version(after(2)), {
        ...final,
        scoreA: 8,
      });
      // …while Bees' captain confirms the ref's.
      await respondToScore(db, {
        gameId: t.gameId,
        reportId: required((await t.reports())[0]?.id, "report"),
        teamSeasonId: t.w.bees.id,
        userId: t.capB,
        status: "confirmed",
        note: "",
        now: after(3),
      });
      const { result } = await t.apply(entry);
      expect(result).toEqual({
        status: "kept",
        message:
          "The score went final while you were offline: Aces 7, Bees 4. Yours wasn't saved.",
      });
      expect(await t.reports()).toHaveLength(1);
    });
  });

  it("replaces a score that hasn't changed since the phone saw it, as online", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      await reportScore(db, {
        gameId: t.gameId,
        userId: t.capB,
        role: "captain",
        teamSeasonId: t.w.bees.id,
        score: { ...final, scoreB: 9 },
        clientId: randomUUID(),
        now: after(1),
      });
      const { result } = await t.apply(t.scoreEntry(await t.version()));
      expect(result.status).toBe("saved");
      expect(await t.reports()).toHaveLength(2);
    });
  });

  it("knows a key that already went in as an ordinary submit", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      const entry = t.scoreEntry("none");
      // Submitted online; the answer was lost, so the phone saved it.
      await reportScore(db, {
        gameId: t.gameId,
        userId: t.capA,
        role: "captain",
        teamSeasonId: t.w.aces.id,
        score: final,
        clientId: entry.key,
        now: after(1),
      });
      expect(await t.apply(entry)).toEqual({
        result: {
          status: "unchanged",
          message: "Your score was already saved.",
        },
        changed: false,
      });
      expect(await t.reports()).toHaveLength(1);
      expect(await t.asked()).toEqual([t.capB]);
    });
  });

  it("refuses a score the rules don't allow, and says why", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      const entry = t.scoreEntry("none", {
        outcome: "called",
        scoreA: 3,
        scoreB: 2,
        inningsPlayed: null,
      });
      const { result, changed } = await t.apply(entry);
      expect(changed).toBe(false);
      expect(result).toEqual({
        status: "refused",
        message: "A called game counts after 4 complete innings or more.",
      });
      expect(await t.reports()).toHaveLength(0);
    });
  });

  it("never gives one person's answer to another", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      const entry = t.scoreEntry("none");
      await t.apply(entry);
      expect(
        await t.apply(entry, { userId: t.capB, team: t.w.bees.id }),
      ).toEqual({
        result: { status: "refused", message: "This entry was already used." },
        changed: false,
      });
    });
  });
});

describe("offline live halves", () => {
  it("saves halves in order, and a resend changes nothing", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      await setKicksFirst(db, { gameId: t.gameId, side: "A", now: after(-50) });
      const top = t.halfEntry(1, "top", 2);
      const bottom = t.halfEntry(1, "bottom", 0);
      expect((await t.apply(top)).result).toEqual({
        status: "saved",
        message: "Saved 2 runs in the top of the 1st.",
      });
      expect((await t.apply(bottom)).changed).toBe(true);
      // The top is taken back on the server; a resend must not put it back.
      await undoLastHalf(db, { gameId: t.gameId, now: after(11) });
      await undoLastHalf(db, { gameId: t.gameId, now: after(11) });
      expect(await t.apply(top)).toEqual({
        result: {
          status: "saved",
          message: "Saved 2 runs in the top of the 1st.",
        },
        changed: false,
      });
      expect(await t.runsIn(1, "top")).toBeNull();
    });
  });

  it("keeps runs someone else saved in that half first", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      await setKicksFirst(db, { gameId: t.gameId, side: "A", now: after(-50) });
      await enterHalf(db, {
        gameId: t.gameId,
        userId: t.capB,
        inning: 1,
        half: "top",
        runs: 4,
        now: after(-20),
      });
      const { result, changed } = await t.apply(t.halfEntry(1, "top", 2));
      expect(changed).toBe(false);
      expect(result).toEqual({
        status: "kept",
        message:
          "Someone else saved 4 runs in the top of the 1st first, so yours (2) wasn't used.",
      });
      expect(await t.runsIn(1, "top")).toBe(4);
    });
  });

  it("applies a correction made to the runs the phone saw", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      await setKicksFirst(db, { gameId: t.gameId, side: "A", now: after(-50) });
      await t.apply(t.halfEntry(1, "top", 2));
      const fix = await t.apply(t.halfEntry(1, "top", 3, 2));
      expect(fix.result.status).toBe("saved");
      expect(await t.runsIn(1, "top")).toBe(3);
      // Already the same: nothing to do.
      expect((await t.apply(t.halfEntry(1, "top", 3, 2))).result.status).toBe(
        "unchanged",
      );
    });
  });

  it("refuses a half that isn't next, with the reason", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      await setKicksFirst(db, { gameId: t.gameId, side: "A", now: after(-50) });
      const { result } = await t.apply(t.halfEntry(2, "top", 1));
      expect(result.status).toBe("refused");
      expect(result.message).toMatch(/wasn't next/);
    });
  });

  it("ends the game from the halves sent before it, once", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      await setKicksFirst(db, { gameId: t.gameId, side: "A", now: after(-50) });
      await t.apply(t.halfEntry(1, "top", 2));
      await t.apply(t.halfEntry(1, "bottom", 5));
      const end = t.endEntry("none");
      expect((await t.apply(end)).result).toEqual({
        status: "saved",
        message: "Saved: Aces 2, Bees 5. It goes final once it's confirmed.",
      });
      expect((await t.apply(end)).changed).toBe(false);
      expect(await t.reports()).toHaveLength(1);
      expect(await t.asked()).toEqual([t.capB]);
    });
  });
});

describe("offline receipts", () => {
  it("go when their game goes", async () => {
    await inRolledBackDb(async (db) => {
      const t = await setUp(db);
      await setKicksFirst(db, { gameId: t.gameId, side: "A", now: after(-50) });
      await t.apply(t.halfEntry(1, "top", 2));
      const gameId: GameId = t.gameId;
      await db.delete(game).where(eq(game.id, gameId));
      expect(
        await db
          .select()
          .from(offlineReceipt)
          .where(eq(offlineReceipt.gameId, gameId)),
      ).toEqual([]);
    });
  });
});
