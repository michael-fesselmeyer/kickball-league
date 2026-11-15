import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { GameId } from "@/domain/ids";
import { ok } from "@/domain/result";
import type { ScoreInput } from "@/domain/scores/scores";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { auditLog } from "../schema/audit";
import { game, scoreReport } from "../schema/game";
import { message } from "../schema/message";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import type { Db } from "./schedule";
import { reportScore } from "./scores";

afterAll(closePool);

const ENDS = new Date("2026-09-14T00:00:00Z");
const after = (minutes: number) => new Date(ENDS.getTime() + minutes * 60_000);
const render = rendererFor({ siteUrl: "https://league.example.test" });

const played: ScoreInput = {
  outcome: "normal",
  scoreA: 7,
  scoreB: 4,
  inningsPlayed: null,
};

async function setup(db: Db) {
  const w = await messagingWorld(db);
  const ref = await w.person("ref");
  const admin = await w.person("admin");
  const { gameId } = await w.gameEnding(ENDS, ref.userId);
  let n = 0;
  const rule = (
    score: ScoreInput,
    reason: string | null,
    minutes: number,
    clientId = `ruling-${w.tag}-${++n}`,
  ) =>
    reportScore(db, {
      gameId,
      userId: admin.userId,
      role: "admin",
      teamSeasonId: null,
      score,
      reason,
      clientId,
      now: after(minutes),
    });
  return { w, ref, admin, gameId, rule };
}

const row = async (db: Db, id: GameId) => {
  const [r] = await db.select().from(game).where(eq(game.id, id));
  if (!r) throw new Error("missing game");
  return r;
};

const told = async (db: Db) =>
  (
    await db
      .select({ userId: message.userId })
      .from(message)
      .where(like(message.dedupeKey, "game-ruling/%"))
  ).map((r) => r.userId);

describe("written rulings", () => {
  it("takes a plain first score from an admin with no reason, and is not a ruling", async () => {
    await inRolledBackDb(async (db) => {
      const { gameId, rule } = await setup(db);
      expect(await rule(played, null, 5)).toMatchObject({ ok: true });
      expect(await row(db, gameId)).toMatchObject({
        status: "final",
        ruledAt: null,
      });
      expect(await told(db)).toEqual([]);
    });
  });

  it("refuses a forfeit, and a change to a final score, without a reason", async () => {
    await inRolledBackDb(async (db) => {
      const { gameId, rule } = await setup(db);
      expect(await rule({ ...played, outcome: "forfeit_a" }, null, 5)).toEqual({
        ok: false,
        error: "reason_needed",
      });
      expect(await rule({ ...played, outcome: "forfeit_a" }, "  ", 5)).toEqual({
        ok: false,
        error: "reason_needed",
      });
      expect((await row(db, gameId)).status).toBe("scheduled");
      await rule(played, null, 6);
      expect(await rule({ ...played, scoreB: 5 }, null, 7)).toEqual({
        ok: false,
        error: "reason_needed",
      });
      expect(await rule(played, "x".repeat(301), 7)).toEqual({
        ok: false,
        error: "reason_too_long",
      });
      expect(await row(db, gameId)).toMatchObject({ scoreB: 4 });
    });
  });

  it("records a forfeit with its reason, audits it and tells both captains and the ref", async () => {
    await inRolledBackDb(async (db) => {
      const { w, ref, admin, gameId, rule } = await setup(db);
      await rule(
        { ...played, outcome: "forfeit_b" },
        "Bees had six players at 8:15.",
        5,
      );
      expect(await row(db, gameId)).toMatchObject({
        status: "forfeit",
        forfeitBy: w.bees.id,
        ruledAt: after(5),
      });
      const [report] = await db
        .select({ reason: scoreReport.reason })
        .from(scoreReport)
        .where(eq(scoreReport.gameId, gameId));
      expect(report?.reason).toBe("Bees had six players at 8:15.");
      const audit = await db
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.actorId, admin.userId));
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action).toBe("game.forfeit");
      expect(audit[0]?.after).toMatchObject({
        reason: "Bees had six players at 8:15.",
      });
      expect((await told(db)).sort()).toEqual(
        [w.aces.captain.userId, w.bees.captain.userId, ref.userId].sort(),
      );

      const sent: Email[] = [];
      const send: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `e-${sent.length}` });
      };
      await drainOutbox(db, { send, render, now: after(10) });
      expect(sent).toHaveLength(3);
      expect(sent[0]?.subject).toBe("Ruling: Aces vs Bees");
      expect(sent[0]?.text).toContain("Bees forfeited");
      expect(sent[0]?.text).toContain("Bees had six players at 8:15.");
    });
  });

  it("reverses a forfeit, then re-rules it, each time telling everyone again and auditing it", async () => {
    await inRolledBackDb(async (db) => {
      const { admin, gameId, rule } = await setup(db);
      await rule({ ...played, outcome: "forfeit_b" }, "No show.", 5);
      expect(
        await rule(played, "Bees were stuck in traffic.", 10),
      ).toMatchObject({ ok: true });
      expect(await row(db, gameId)).toMatchObject({
        status: "final",
        forfeitBy: null,
        scoreA: 7,
        scoreB: 4,
        ruledAt: after(10),
      });
      await rule({ ...played, scoreB: 6 }, "Scorecard recount.", 15);
      expect(await row(db, gameId)).toMatchObject({
        scoreB: 6,
        ruledAt: after(15),
      });
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.actorId, admin.userId));
      expect(audit.map((a) => a.action).sort()).toEqual([
        "game.forfeit",
        "game.forfeit_reversed",
        "game.ruling",
      ]);
      // Two captains and the ref, three times.
      expect(await told(db)).toHaveLength(9);
    });
  });

  it("settles a disputed score as a ruling", async () => {
    await inRolledBackDb(async (db) => {
      const { w, gameId, rule } = await setup(db);
      await reportScore(db, {
        gameId,
        userId: w.aces.captain.userId,
        role: "captain",
        teamSeasonId: w.aces.id,
        score: played,
        clientId: `cap-${w.tag}`,
        now: after(2),
      });
      expect(await rule(played, null, 5)).toEqual({
        ok: false,
        error: "reason_needed",
      });
      await rule({ ...played, scoreB: 5 }, "The ref's card shows 7 to 5.", 5);
      expect(await row(db, gameId)).toMatchObject({
        status: "final",
        scoreB: 5,
        ruledAt: after(5),
      });
    });
  });

  it("tells a captain who is also the ref once, and tells nobody twice for a retried submit", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = await w.person("admin");
      const { gameId } = await w.gameEnding(ENDS, w.aces.captain.userId);
      const go = () =>
        reportScore(db, {
          gameId,
          userId: admin.userId,
          role: "admin",
          teamSeasonId: null,
          score: { ...played, outcome: "forfeit_a" },
          reason: "No show.",
          clientId: `same-${w.tag}`,
          now: after(5),
        });
      await go();
      await go();
      expect((await told(db)).sort()).toEqual(
        [w.aces.captain.userId, w.bees.captain.userId].sort(),
      );
    });
  });

  it("works for a game with no ref, and after the season has ended", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = await w.person("admin");
      const { gameId } = await w.gameEnding(ENDS);
      const result = await reportScore(db, {
        gameId,
        userId: admin.userId,
        role: "admin",
        teamSeasonId: null,
        score: { ...played, outcome: "forfeit_a" },
        reason: "No show.",
        clientId: `late-${w.tag}`,
        now: new Date("2027-03-01T00:00:00Z"),
      });
      expect(result).toMatchObject({ ok: true });
      expect((await told(db)).sort()).toEqual(
        [w.aces.captain.userId, w.bees.captain.userId].sort(),
      );
    });
  });

  it("ignores a reason from anyone but an admin", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const { gameId } = await w.gameEnding(ENDS);
      await reportScore(db, {
        gameId,
        userId: w.aces.captain.userId,
        role: "captain",
        teamSeasonId: w.aces.id,
        score: played,
        reason: "Sneaky",
        clientId: `cap-${w.tag}`,
        now: after(5),
      });
      const [r] = await db
        .select({ reason: scoreReport.reason })
        .from(scoreReport)
        .where(eq(scoreReport.gameId, gameId));
      expect(r?.reason).toBeNull();
      expect(await told(db)).toEqual([]);
    });
  });
});
