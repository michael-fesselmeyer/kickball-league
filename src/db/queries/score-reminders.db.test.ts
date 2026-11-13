import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { game, scoreReport, slot } from "../schema/game";
import { message } from "../schema/message";
import { rosterMembership } from "../schema/team";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import type { Db } from "./schedule";
import { queueScoreReminders, scoreReminderLog } from "./score-reminders";

afterAll(closePool);

const ENDS = new Date("2026-09-14T00:00:00Z");
const after = (minutes: number) => new Date(ENDS.getTime() + minutes * 60_000);
const render = rendererFor({ siteUrl: "https://league.example.test" });

function recorder() {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `provider-${sent.length}` });
  };
  return { sent, send };
}

const reminderKeys = async (db: Db) =>
  (
    await db
      .select({ key: message.dedupeKey })
      .from(message)
      .where(like(message.dedupeKey, "score-reminder/%"))
  ).map((r) => r.key);

describe("queueScoreReminders", () => {
  it("reminds the ref at 30 minutes and both captains at 2 hours, once each", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(ENDS, ref.userId);

      expect(await queueScoreReminders(db, after(29))).toBe(0);
      expect(await queueScoreReminders(db, after(30))).toBe(1);
      expect(await queueScoreReminders(db, after(60))).toBe(0);
      expect(await queueScoreReminders(db, after(120))).toBe(2);
      expect(await queueScoreReminders(db, after(180))).toBe(0);
      expect((await reminderKeys(db)).sort()).toEqual(
        [
          `score-reminder/${gameId}/captain/${w.aces.captain.userId}`,
          `score-reminder/${gameId}/captain/${w.bees.captain.userId}`,
          `score-reminder/${gameId}/referee/${ref.userId}`,
        ].sort(),
      );

      const { sent, send } = recorder();
      // 11 pm in New York is quiet hours: the reminders wait until 8 am.
      await drainOutbox(db, { send, render, now: after(180) });
      expect(sent).toEqual([]);
      await drainOutbox(db, { send, render, now: after(12 * 60) });
      expect(sent.map((e) => e.to).sort()).toEqual(
        [ref.email, w.aces.captain.email, w.bees.captain.email].sort(),
      );
      expect(sent[0]?.subject).toBe("Score needed: Aces vs Bees");
      expect(sent[0]?.text).toContain(`/app/games/${gameId}/score`);

      const log = (await scoreReminderLog(db, [gameId])).get(gameId);
      expect(log?.referee).toBeInstanceOf(Date);
      expect(log?.captains).toBeInstanceOf(Date);
    });
  });

  it("goes straight to the captains when there is no ref, including co-captains", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const co = w.aces.players[0];
      if (!co) throw new Error("missing player");
      await db
        .update(rosterMembership)
        .set({ role: "co_captain" })
        .where(eq(rosterMembership.registrationId, co.registrationId));
      await w.gameEnding(ENDS);
      expect(await queueScoreReminders(db, after(30))).toBe(0);
      expect(await queueScoreReminders(db, after(120))).toBe(3);
    });
  });

  it("leaves games alone once a score is in, or when the slot was rained out", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const scored = await w.gameEnding(ENDS, ref.userId);
      await db.insert(scoreReport).values({
        gameId: scored.gameId,
        reportedBy: ref.userId,
        reporterRole: "referee",
        scoreA: 5,
        scoreB: 3,
        clientId: `report-${w.tag}`,
      });
      const rained = await w.gameEnding(after(60), ref.userId);
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.id, rained.slotId));
      await db
        .update(game)
        .set({ status: "postponed" })
        .where(eq(game.id, rained.gameId));
      expect(await queueScoreReminders(db, after(300))).toBe(0);
    });
  });

  it("does not email about games that ended days ago", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      await w.gameEnding(ENDS);
      expect(await queueScoreReminders(db, after(3 * 24 * 60))).toBe(0);
    });
  });
});
