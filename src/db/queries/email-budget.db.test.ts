import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import type { EmailBudget } from "@/domain/notifications/email-budget";
import { err, ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import type { PushSender } from "@/services/push";
import { user } from "../schema/auth";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { closePool, inRolledBackDb } from "../test/transaction";
import { saveAlertLimits } from "./notifications";
import { drainOutbox, enqueueMessages, type OutboxMessage } from "./outbox";
import { savePushSettings, savePushSubscription } from "./push";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const TZ = "America/New_York";
/** Mon Sep 14, 2026, noon in New York. */
const NOON = new Date("2026-09-14T16:00:00Z");
/** Midnight UTC that night, when the provider's quota resets. */
const RESET = new Date("2026-09-15T00:00:00Z");
const render = rendererFor({ siteUrl: "https://league.example.test" });
/** A small quota, so a handful of messages uses it up. */
const BUDGET: EmailBudget = { daily: 6, monthly: 3000, reserve: 2 };

function emails(answer: (email: Email) => boolean = () => true) {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return answer(email)
      ? ok({ id: `email-${sent.length}` })
      : err(
          "Resend refused the email (429 daily_quota_exceeded): You have reached your daily email sending quota.",
        );
  };
  return { sent, send };
}

const pushes: PushSender = async () => ({ ok: true, id: "push" });

async function people(db: Db, n: number, label: string): Promise<UserId[]> {
  const tag = Math.random().toString(36).slice(2, 8);
  const rows = await db
    .insert(user)
    .values(
      Array.from({ length: n }, (_, i) => ({
        name: `${label} ${i}`,
        email: `budget-${label}-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  return rows.map((r) => r.id);
}

async function admin(db: Db): Promise<UserId> {
  const [id] = await people(db, 1, "admin");
  await db
    .insert(profile)
    .values({ userId: required(id, "admin"), globalRole: "admin" });
  return required(id, "admin");
}

async function withPhone(db: Db, userId: UserId) {
  await savePushSubscription(db, userId, {
    endpoint: `https://push.example.test/send/${Math.random().toString(36).slice(2)}`,
    keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
    userAgent: null,
  });
  await savePushSettings(db, userId, new Set(["rainout"]));
}

const rainout = (userId: UserId): OutboxMessage => ({
  userId,
  topic: "rainout",
  template: "rainout_notice",
  payload: {
    seasonName: "Fall 2026",
    seasonSlug: "fall-2026",
    teams: "Aces vs Bees",
    was: "Mon, Sep 14, 7:00 PM, Field 2",
    makeup: null,
  },
  dedupeKey: `rainout/g1/${userId}`,
  sendAfter: NOON,
});

const news = (userId: UserId): OutboxMessage => ({
  userId,
  topic: "announcement",
  template: "announcement",
  payload: {
    subject: "Bring water",
    body: "It will be hot.",
    from: "League admins",
    seasonName: "Fall 2026",
    seasonSlug: "fall-2026",
  },
  dedupeKey: `news/water/${userId}`,
  sendAfter: NOON,
});

const drain = (db: Db, send: EmailSender, now = NOON) =>
  drainOutbox(db, {
    send,
    push: pushes,
    render,
    now,
    timeZone: TZ,
    emailBudget: BUDGET,
  });

const emailRows = (db: Db, template = "rainout_notice") =>
  db
    .select()
    .from(message)
    .where(and(eq(message.channel, "email"), eq(message.template, template)));

describe("the email budget", () => {
  it("spends the quota on people without push, and counts the rest as pushed", async () => {
    await inRolledBackDb(async (db) => {
      const withoutPush = await people(db, 4, "plain");
      const withPush = await people(db, 3, "phone");
      for (const p of withPush) await withPhone(db, p);
      await enqueueMessages(db, [...withPush, ...withoutPush].map(rainout));
      const { sent, send } = emails();

      const result = await drain(db, send);
      // 6 a day, 2 kept back: 4 ordinary emails, all to people without push.
      expect(sent).toHaveLength(4);
      expect(result).toMatchObject({ sent: 4 + 3, suppressed: 3 });
      const rows = await emailRows(db);
      expect(
        rows
          .filter((r) => r.status === "suppressed")
          .map((r) => [r.userId, r.suppressReason])
          .sort(),
      ).toEqual(withPush.map((id) => [id, "sent_by_push"]).sort());
    });
  });

  it("keeps urgent email for tomorrow and tells the admins, once", async () => {
    await inRolledBackDb(async (db) => {
      const boss = await admin(db);
      const players = await people(db, 7, "plain");
      await enqueueMessages(db, players.map(rainout));
      const { sent, send } = emails();

      expect(await drain(db, send)).toMatchObject({ sent: 4, nextDay: 3 });
      const waiting = (await emailRows(db)).filter(
        (r) => r.status === "queued",
      );
      expect(waiting).toHaveLength(3);
      for (const r of waiting) {
        expect(r.sendAfter).toEqual(RESET);
        expect(r.attempts).toBe(0);
      }
      // The notice to the admin goes out of the reserve.
      await drain(db, send);
      const notices = sent.filter((e) =>
        e.subject.startsWith("Urgent email is waiting"),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]?.text).toContain("3 urgent emails could not go today");
      expect(
        (await emailRows(db, "email_budget")).map((r) => r.userId),
      ).toEqual([boss]);
      // Later drains the same day send nothing more.
      await drain(db, send, new Date("2026-09-14T22:00:00Z"));
      expect(sent).toHaveLength(5);
      // After the reset the rest go.
      await drain(db, send, RESET);
      expect(sent).toHaveLength(8);
      expect(
        (await emailRows(db)).filter((r) => r.status === "sent"),
      ).toHaveLength(7);
    });
  });

  it("folds news the quota cannot cover into the digest", async () => {
    await inRolledBackDb(async (db) => {
      const players = await people(db, 6, "plain");
      for (const p of players)
        await saveAlertLimits(
          db,
          p,
          { dailyCap: 3, digest: "daily", quietHours: null },
          { now: NOON, timeZone: TZ },
        );
      await enqueueMessages(db, players.map(news));
      const { sent, send } = emails();
      expect(await drain(db, send)).toMatchObject({ sent: 4, held: 2 });
      const held = (await emailRows(db, "announcement")).filter(
        (r) => r.status === "held",
      );
      // 6 pm in New York, that day's digest.
      for (const r of held)
        expect(r.sendAfter).toEqual(new Date("2026-09-14T22:00:00Z"));
      expect(sent).toHaveLength(4);
    });
  });

  it("waits for tomorrow when the provider says the quota is gone", async () => {
    await inRolledBackDb(async (db) => {
      const players = await people(db, 3, "plain");
      await enqueueMessages(db, players.map(rainout));
      // The account sent mail elsewhere today: the provider refuses at once.
      const { sent, send } = emails(() => false);
      expect(await drain(db, send)).toMatchObject({
        sent: 0,
        failed: 0,
        retrying: 0,
        nextDay: 3,
      });
      // One refusal stops the rest from being tried.
      expect(sent).toHaveLength(1);
      for (const r of await emailRows(db)) {
        expect(r.status).toBe("queued");
        expect(r.sendAfter).toEqual(RESET);
        expect(r.attempts).toBe(0);
      }
    });
  });

  it("never sends more than the day's quota, however often it drains", async () => {
    await inRolledBackDb(async (db) => {
      await admin(db);
      const players = await people(db, 20, "plain");
      await enqueueMessages(db, players.map(rainout));
      const { sent, send } = emails();
      for (let hour = 12; hour < 20; hour++)
        await drain(db, send, new Date(`2026-09-14T${hour}:00:00Z`));
      // Ordinary email stops at 4; the reserve carries the one admin notice.
      expect(sent.length).toBeLessThanOrEqual(BUDGET.daily);
      expect(
        sent.filter((e) => !e.subject.startsWith("Urgent email is waiting")),
      ).toHaveLength(BUDGET.daily - BUDGET.reserve);
      // Nothing urgent was dropped: every rain-out is sent or waiting.
      const rows = await emailRows(db);
      expect(rows.filter((r) => r.status === "sent")).toHaveLength(4);
      expect(rows.filter((r) => r.status === "queued")).toHaveLength(16);
    });
  });
});
