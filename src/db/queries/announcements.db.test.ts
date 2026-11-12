import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ok } from "@/domain/result";
import type { Email, EmailSender } from "@/services/email";
import { rendererFor } from "@/emails/templates";
import { auditLog } from "../schema/audit";
import { message } from "../schema/message";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  announcementsOf,
  audienceOf,
  DAILY_LIMIT,
  sendAnnouncement,
} from "./announcements";
import { saveEmailSettings, emailSettingsOf } from "./notifications";
import { drainOutbox } from "./outbox";

afterAll(closePool);

const NOW = new Date("2026-09-14T12:00:00Z");
const render = rendererFor({ siteUrl: "https://league.example.test" });

function recorder() {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `provider-${sent.length}` });
  };
  return { sent, send };
}

describe("audienceOf", () => {
  it("is the team's active roster, or everyone registered for the season", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const aces = await audienceOf(db, w.season.id, w.aces.id);
      expect(aces.sort()).toEqual(
        [w.aces.captain, ...w.aces.players].map((p) => p.userId).sort(),
      );
      const league = await audienceOf(db, w.season.id, null);
      expect(league).toHaveLength(7);
      expect(league).toContain(w.freeAgent.userId);
      expect(league).not.toContain(w.cancelled.userId);
    });
  });
});

describe("sendAnnouncement", () => {
  it("queues one email per teammate and sends each once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const result = await sendAnnouncement(db, {
        authorId: w.aces.captain.userId,
        role: "captain",
        seasonId: w.season.id,
        seasonName: w.season.name,
        seasonSlug: w.season.slug,
        team: { id: w.aces.id, name: "Aces" },
        from: "ace-cap, captain of Aces",
        subject: "  Practice Thursday ",
        body: "Meet at 6.",
        now: NOW,
      });
      if (!result.ok) throw new Error(result.error);
      expect(result.value.recipients).toBe(3);

      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: NOW });
      await drainOutbox(db, { send, render, now: NOW });
      expect(sent.map((e) => e.to).sort()).toEqual(
        [w.aces.captain, ...w.aces.players].map((p) => p.email).sort(),
      );
      expect(sent[0]).toMatchObject({ subject: "Practice Thursday" });
      expect(sent[0]?.text).toContain("because you play on Aces in Fall 2026");

      const [summary] = await announcementsOf(db, w.season.id, w.aces.id);
      expect(summary).toMatchObject({
        subject: "Practice Thursday",
        recipientCount: 3,
        delivery: { sent: 3 },
      });
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, result.value.id));
      expect(audit).toEqual([{ action: "announcement.send" }]);
    });
  });

  it("skips people who turned announcements off", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const muted = w.bees.players[0];
      if (!muted) throw new Error("missing player");
      await saveEmailSettings(db, muted.userId, new Set());
      expect(await emailSettingsOf(db, muted.userId)).toContainEqual(
        expect.objectContaining({ topic: "announcement", enabled: false }),
      );
      const result = await sendAnnouncement(db, {
        authorId: w.aces.captain.userId,
        role: "admin",
        seasonId: w.season.id,
        seasonName: w.season.name,
        seasonSlug: w.season.slug,
        team: null,
        from: "League admins",
        subject: "Opening day",
        body: "See you Saturday.",
        now: NOW,
      });
      expect(result.ok && result.value.recipients).toBe(7);
      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: NOW });
      expect(sent).toHaveLength(6);
      expect(sent.map((e) => e.to)).not.toContain(muted.email);
      const [summary] = await announcementsOf(db, w.season.id);
      expect(summary?.delivery).toEqual({ sent: 6, suppressed: 1 });
    });
  });

  it("refuses empty or long text, an empty audience, and too many a day", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const base = {
        authorId: w.bees.captain.userId,
        role: "captain" as const,
        seasonId: w.season.id,
        seasonName: w.season.name,
        seasonSlug: w.season.slug,
        team: { id: w.bees.id, name: "Bees" },
        from: "bee-cap, captain of Bees",
        subject: "Hi",
        body: "Hello",
        now: NOW,
      };
      expect(await sendAnnouncement(db, { ...base, body: "  " })).toEqual({
        ok: false,
        error: "empty",
      });
      expect(
        await sendAnnouncement(db, { ...base, subject: "x".repeat(121) }),
      ).toEqual({ ok: false, error: "too_long" });
      const empty = await w.person("solo");
      expect(
        await sendAnnouncement(db, {
          ...base,
          authorId: empty.userId,
          team: { id: await w.entry("Empty"), name: "Empty" },
        }),
      ).toEqual({ ok: false, error: "no_recipients" });

      for (let i = 0; i < DAILY_LIMIT.captain; i++)
        expect((await sendAnnouncement(db, base)).ok).toBe(true);
      expect(await sendAnnouncement(db, base)).toEqual({
        ok: false,
        error: "rate_limited",
      });
      // A day later the captain may write again.
      expect(
        (
          await sendAnnouncement(db, {
            ...base,
            now: new Date(NOW.getTime() + 24 * 3_600_000 + 1),
          })
        ).ok,
      ).toBe(true);
      expect(
        await db
          .select({ id: message.id })
          .from(message)
          .where(eq(message.userId, w.bees.captain.userId)),
      ).toHaveLength(DAILY_LIMIT.captain + 1);
    });
  });
});
