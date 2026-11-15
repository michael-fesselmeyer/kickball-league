import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { AnnouncementId } from "@/domain/ids";
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
  cancelScheduledAnnouncement,
  DAILY_LIMIT,
  editScheduledAnnouncement,
  releaseDueAnnouncements,
  scheduledAnnouncements,
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

describe("scheduled announcements", () => {
  const SWEEP = new Date("2026-09-16T13:30:00Z");

  async function schedule(db: Parameters<typeof sendAnnouncement>[0]) {
    const w = await messagingWorld(db);
    const result = await sendAnnouncement(db, {
      authorId: w.aces.captain.userId,
      role: "admin",
      seasonId: w.season.id,
      seasonName: w.season.name,
      seasonSlug: w.season.slug,
      team: null,
      from: "League admins",
      subject: "Picture day",
      body: "Wear your shirts.",
      now: NOW,
      sendAt: SWEEP,
    });
    if (!result.ok) throw new Error(result.error);
    return { w, id: result.value.id };
  }

  const queuedFor = (
    db: Parameters<typeof sendAnnouncement>[0],
    id: AnnouncementId,
  ) =>
    db
      .select({ userId: message.userId, from: message.payload })
      .from(message)
      .where(eq(message.announcementId, id));

  it("waits for its sweep, then goes to the audience as it stands", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await schedule(db);
      expect(await queuedFor(db, id)).toEqual([]);
      expect(await announcementsOf(db, w.season.id)).toEqual([]);
      expect(await scheduledAnnouncements(db, w.season.id)).toMatchObject([
        { id, subject: "Picture day", sendAt: SWEEP },
      ]);

      // Before the sweep, nothing goes.
      const early = new Date(SWEEP.getTime() - 60_000);
      expect(await releaseDueAnnouncements(db, early)).toEqual({
        announcements: 0,
        messages: 0,
      });

      expect(await releaseDueAnnouncements(db, SWEEP)).toEqual({
        announcements: 1,
        messages: 7,
      });
      const queued = await queuedFor(db, id);
      expect(queued).toHaveLength(7);
      expect(queued[0]?.from).toMatchObject({
        subject: "Picture day",
        from: "League admins",
        seasonName: w.season.name,
      });
      // A second sweep sends nothing more.
      expect(await releaseDueAnnouncements(db, SWEEP)).toEqual({
        announcements: 0,
        messages: 0,
      });
      expect(await scheduledAnnouncements(db, w.season.id)).toEqual([]);
      const [sent] = await announcementsOf(db, w.season.id);
      expect(sent).toMatchObject({ id, recipientCount: 7 });

      const { sent: emails, send } = recorder();
      await drainOutbox(db, { send, render, now: SWEEP });
      expect(emails).toHaveLength(7);
    });
  });

  it("can be edited or cancelled until it sends, and not after", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await schedule(db);
      const later = new Date("2026-09-17T13:30:00Z");
      const edit = (over: Record<string, unknown> = {}) =>
        editScheduledAnnouncement(db, {
          id,
          seasonId: w.season.id,
          actorId: w.aces.captain.userId,
          subject: "Picture day moved",
          body: "Wear your shirts on Thursday.",
          sendAt: later,
          ...over,
        });
      expect(await edit({ subject: " " })).toEqual({
        ok: false,
        error: "empty",
      });
      expect(await edit()).toEqual({ ok: true, value: undefined });
      expect(await scheduledAnnouncements(db, w.season.id)).toMatchObject([
        { subject: "Picture day moved", sendAt: later },
      ]);
      // Its old sweep has no effect now.
      await releaseDueAnnouncements(db, SWEEP);
      expect(await queuedFor(db, id)).toEqual([]);

      const cancel = () =>
        cancelScheduledAnnouncement(db, {
          id,
          seasonId: w.season.id,
          actorId: w.aces.captain.userId,
          now: NOW,
        });
      expect(await cancel()).toEqual({ ok: true, value: undefined });
      expect(await cancel()).toEqual({ ok: false, error: "already_sent" });
      expect(await edit()).toEqual({ ok: false, error: "already_sent" });
      await releaseDueAnnouncements(db, later);
      expect(await queuedFor(db, id)).toEqual([]);
      expect(await scheduledAnnouncements(db, w.season.id)).toEqual([]);

      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit.map((a) => a.action).sort()).toEqual([
        "announcement.cancel",
        "announcement.edit",
        "announcement.schedule",
      ]);
    });
  });

  it("can't change once it has gone out", async () => {
    await inRolledBackDb(async (db) => {
      const { w, id } = await schedule(db);
      await releaseDueAnnouncements(db, SWEEP);
      expect(
        await cancelScheduledAnnouncement(db, {
          id,
          seasonId: w.season.id,
          actorId: w.aces.captain.userId,
          now: SWEEP,
        }),
      ).toEqual({ ok: false, error: "already_sent" });
    });
  });
});
