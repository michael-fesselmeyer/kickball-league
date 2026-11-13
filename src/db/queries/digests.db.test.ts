import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { DEFAULT_LIMITS } from "@/domain/notifications/limits";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import type { PushNotification, PushSender } from "@/services/push";
import { user } from "../schema/auth";
import { message } from "../schema/message";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import { buildDigests } from "./digests";
import {
  alertLimitsFor,
  saveAlertLimits,
  saveEmailSettings,
} from "./notifications";
import {
  drainOutbox,
  enqueueMessages,
  type OutboxMessage,
  PUSH_SETTINGS_PATH,
  pushKey,
} from "./outbox";
import { savePushSettings, savePushSubscription } from "./push";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const TZ = "America/New_York";
/** Mon Sep 14, 2026, noon in New York. */
const NOON = new Date("2026-09-14T16:00:00Z");
/** The same night, 11 pm in New York: quiet hours. */
const NIGHT = new Date("2026-09-15T03:00:00Z");
/** 8 am the next morning, when quiet hours end. */
const MORNING = new Date("2026-09-15T12:00:00Z");
/** 6 pm on Mon Sep 14: that day's digest. */
const DIGEST_TIME = new Date("2026-09-14T22:00:00Z");
const render = rendererFor({ siteUrl: "https://league.example.test" });

function emails() {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `email-${sent.length}` });
  };
  return { sent, send };
}

/** A push sender that records each notification it was asked to show. */
function pushes() {
  const shown: PushNotification[] = [];
  const push: PushSender = async (_device, notification) => {
    shown.push(notification);
    return { ok: true, id: `push-${shown.length}` };
  };
  return { shown, push };
}

async function person(db: Db): Promise<UserId> {
  const tag = Math.random().toString(36).slice(2, 10);
  const [row] = await db
    .insert(user)
    .values({ name: "Pat", email: `limits-${tag}@example.test` })
    .returning({ id: user.id });
  return required(row, "user").id;
}

async function withPhone(db: Db, userId: UserId, topics: string[]) {
  await savePushSubscription(db, userId, {
    endpoint: `https://push.example.test/send/${Math.random().toString(36).slice(2)}`,
    keys: {
      p256dh: `B${"A".repeat(86)}`,
      auth: "A".repeat(22),
    },
    userAgent: null,
  });
  await savePushSettings(db, userId, new Set(topics));
}

const news = (userId: UserId, n: number, at = NOON): OutboxMessage => ({
  userId,
  topic: "announcement",
  template: "announcement",
  payload: {
    subject: `Kickball news ${n}`,
    body: `Story number ${n}.`,
    from: "League admins",
    seasonName: "Fall 2026",
    seasonSlug: "fall-2026",
  },
  dedupeKey: `news/${n}/${userId}`,
  sendAfter: at,
});

const scoreNeeded = (userId: UserId, n: number): OutboxMessage => ({
  userId,
  topic: "score",
  template: "score_reminder",
  payload: {
    gameId: `g${n}`,
    teams: "Aces vs Bees",
    when: "Sun, Sep 13, 7:00 PM, Field 2",
    role: "captain",
  },
  dedupeKey: `score-reminder/g${n}/${userId}`,
  sendAfter: NOON,
});

const rainout = (userId: UserId, at = NOON): OutboxMessage => ({
  userId,
  topic: "rainout",
  template: "rainout_notice",
  payload: {
    seasonName: "Fall 2026",
    seasonSlug: "fall-2026",
    teams: "Aces vs Bees",
    was: "Mon, Sep 14, 11:00 PM, Field 2",
    makeup: null,
  },
  dedupeKey: `rainout/g1/${userId}`,
  sendAfter: at,
});

const rowsOf = (db: Db, userId: UserId) =>
  db.select().from(message).where(eq(message.userId, userId));

const statusOf = async (db: Db, dedupeKey: string) =>
  required(
    (
      await db
        .select({ status: message.status, sendAfter: message.sendAfter })
        .from(message)
        .where(eq(message.dedupeKey, dedupeKey))
    )[0],
    dedupeKey,
  );

describe("the daily cap", () => {
  it("sends three non-urgent emails a day and holds the rest for the digest", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const { sent, send } = emails();
      await enqueueMessages(
        db,
        [1, 2, 3, 4, 5].map((n) => news(pat, n)),
      );
      const result = await drainOutbox(db, {
        send,
        render,
        now: NOON,
        timeZone: TZ,
      });
      expect(result).toMatchObject({ sent: 3, held: 2 });
      expect(sent).toHaveLength(3);
      const held = (await rowsOf(db, pat)).filter((m) => m.status === "held");
      expect(held).toHaveLength(2);
      // Held for 6 pm that day, with the claim's attempt given back.
      for (const m of held) {
        expect(m.sendAfter).toEqual(DIGEST_TIME);
        expect(m.attempts).toBe(0);
      }
    });
  });

  it("counts what was already sent today, and starts over the next day", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const { sent, send } = emails();
      await saveAlertLimits(
        db,
        pat,
        { ...DEFAULT_LIMITS, dailyCap: 1 },
        { now: NOON, timeZone: TZ },
      );
      await enqueueMessages(db, [news(pat, 1)]);
      await drainOutbox(db, { send, render, now: NOON, timeZone: TZ });
      await enqueueMessages(db, [news(pat, 2)]);
      expect(
        await drainOutbox(db, { send, render, now: NOON, timeZone: TZ }),
      ).toMatchObject({ sent: 0, held: 1 });
      const tomorrow = new Date("2026-09-15T16:00:00Z");
      await enqueueMessages(db, [news(pat, 3, tomorrow)]);
      expect(
        await drainOutbox(db, { send, render, now: tomorrow, timeZone: TZ }),
      ).toMatchObject({ sent: 1, held: 0 });
      expect(sent.map((e) => e.subject)).toEqual([
        "Kickball news 1",
        "Kickball news 3",
      ]);
    });
  });

  it("never holds an urgent message, however many came first", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const { sent, send } = emails();
      await saveAlertLimits(
        db,
        pat,
        { ...DEFAULT_LIMITS, dailyCap: 0 },
        { now: NOON, timeZone: TZ },
      );
      await enqueueMessages(db, [news(pat, 1), rainout(pat)]);
      expect(
        await drainOutbox(db, { send, render, now: NOON, timeZone: TZ }),
      ).toMatchObject({ sent: 1, held: 1 });
      expect(sent.map((e) => e.subject)).toEqual([
        expect.stringContaining("Aces vs Bees"),
      ]);
    });
  });
});

describe("quiet hours", () => {
  it("queues a non-urgent message again for 8 am", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const { sent, send } = emails();
      await enqueueMessages(db, [news(pat, 1, NIGHT)]);
      expect(
        await drainOutbox(db, { send, render, now: NIGHT, timeZone: TZ }),
      ).toMatchObject({ sent: 0, waiting: 1 });
      expect(await statusOf(db, `news/1/${pat}`)).toEqual({
        status: "queued",
        sendAfter: MORNING,
      });
      expect(
        await drainOutbox(db, { send, render, now: MORNING, timeZone: TZ }),
      ).toMatchObject({ sent: 1 });
      expect(sent).toHaveLength(1);
    });
  });

  it("sends an urgent message at night, with a silent push", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await withPhone(db, pat, ["rainout"]);
      const { sent, send } = emails();
      const { shown, push } = pushes();
      await enqueueMessages(db, [rainout(pat, NIGHT)]);
      expect(
        await drainOutbox(db, { send, push, render, now: NIGHT, timeZone: TZ }),
      ).toMatchObject({ sent: 2, waiting: 0, held: 0 });
      expect(sent).toHaveLength(1);
      expect(shown).toEqual([
        expect.objectContaining({
          silent: true,
          reason: "Because you play in this game in Fall 2026.",
          settingsPath: PUSH_SETTINGS_PATH,
        }),
      ]);
    });
  });

  it("follows the person's own quiet hours, or none", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const { sent, send } = emails();
      await saveAlertLimits(
        db,
        pat,
        { ...DEFAULT_LIMITS, quietHours: null },
        { now: NIGHT, timeZone: TZ },
      );
      await enqueueMessages(db, [news(pat, 1, NIGHT)]);
      await drainOutbox(db, { send, render, now: NIGHT, timeZone: TZ });
      expect(sent).toHaveLength(1);
    });
  });
});

describe("buildDigests", () => {
  it("gathers a person's held messages into one digest email, once", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const { sent, send } = emails();
      await saveAlertLimits(
        db,
        pat,
        { ...DEFAULT_LIMITS, dailyCap: 0 },
        { now: NOON, timeZone: TZ },
      );
      await enqueueMessages(db, [news(pat, 1), news(pat, 2)]);
      await drainOutbox(db, { send, render, now: NOON, timeZone: TZ });
      expect(sent).toHaveLength(0);

      // Not yet due before 6 pm.
      expect((await buildDigests(db, { render, now: NOON })).digests).toBe(0);
      expect(await buildDigests(db, { render, now: DIGEST_TIME })).toEqual({
        digests: 1,
        messages: 2,
        suppressed: 0,
        failed: 0,
      });
      // Running it again finds nothing left.
      expect(
        (await buildDigests(db, { render, now: DIGEST_TIME })).digests,
      ).toBe(0);

      const rows = await rowsOf(db, pat);
      const digest = required(
        rows.find((m) => m.template === "digest"),
        "digest",
      );
      expect(rows.filter((m) => m.status === "digested")).toEqual([
        expect.objectContaining({ digestId: digest.id }),
        expect.objectContaining({ digestId: digest.id }),
      ]);

      // The digest is never capped: it goes even with the cap at 0.
      await drainOutbox(db, { send, render, now: DIGEST_TIME, timeZone: TZ });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.subject).toBe("League news: 2 updates");
      expect(sent[0]?.text).toContain("Kickball news 1");
      expect(sent[0]?.text).toContain("Kickball news 2");
      expect(sent[0]?.text).toContain(
        "you chose to get news that can wait in one daily email",
      );
      expect(sent[0]?.text).toContain("/app/profile#alert-limits");
    });
  });

  it("lists a notice held on email and push once", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await withPhone(db, pat, ["score"]);
      const { send } = emails();
      const { push } = pushes();
      await saveAlertLimits(
        db,
        pat,
        { ...DEFAULT_LIMITS, dailyCap: 0 },
        { now: NOON, timeZone: TZ },
      );
      await enqueueMessages(db, [scoreNeeded(pat, 1)]);
      expect(
        await drainOutbox(db, { send, push, render, now: NOON, timeZone: TZ }),
      ).toMatchObject({ held: 2 });
      expect(await buildDigests(db, { render, now: DIGEST_TIME })).toEqual({
        digests: 1,
        messages: 2,
        suppressed: 0,
        failed: 0,
      });
      const digest = required(
        (await rowsOf(db, pat)).find((m) => m.template === "digest"),
        "digest",
      );
      expect(digest.payload).toMatchObject({
        items: [
          expect.objectContaining({ title: "What was the final score?" }),
        ],
      });
    });
  });

  it("skips a held push whose email already went, and anything turned off since", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await withPhone(db, pat, ["score"]);
      const { sent, send } = emails();
      const { push } = pushes();
      // Email is under the cap; the push is not, so only the push is held.
      await enqueueMessages(db, [scoreNeeded(pat, 1)]);
      await db
        .update(message)
        .set({ status: "held", sendAfter: DIGEST_TIME })
        .where(eq(message.dedupeKey, pushKey(`score-reminder/g1/${pat}`)));
      await drainOutbox(db, { send, push, render, now: NOON, timeZone: TZ });
      expect(sent).toHaveLength(1);
      await saveAlertLimits(
        db,
        pat,
        { ...DEFAULT_LIMITS, dailyCap: 0 },
        { now: NOON, timeZone: TZ },
      );
      await enqueueMessages(db, [news(pat, 1)]);
      await drainOutbox(db, { send, push, render, now: NOON, timeZone: TZ });
      await saveEmailSettings(db, pat, new Set(["rainout"]));

      expect(await buildDigests(db, { render, now: DIGEST_TIME })).toEqual({
        digests: 0,
        messages: 0,
        suppressed: 2,
        failed: 0,
      });
      const reasons = (await rowsOf(db, pat))
        .filter((m) => m.status === "suppressed")
        .map((m) => m.suppressReason)
        .sort();
      expect(reasons).toEqual(["opted_out", "sent_by_email"]);
    });
  });

  it("leaves held messages of other people alone until their digest is due", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const sam = await person(db);
      const { send } = emails();
      for (const who of [pat, sam])
        await saveAlertLimits(
          db,
          who,
          { ...DEFAULT_LIMITS, dailyCap: 0 },
          { now: NOON, timeZone: TZ },
        );
      await saveAlertLimits(
        db,
        sam,
        { ...DEFAULT_LIMITS, dailyCap: 0, digest: "weekly" },
        { now: NOON, timeZone: TZ },
      );
      await enqueueMessages(db, [news(pat, 1), news(sam, 1)]);
      await drainOutbox(db, { send, render, now: NOON, timeZone: TZ });
      // Sam's weekly digest is Sunday Sep 20 at 6 pm.
      expect(await statusOf(db, `news/1/${sam}`)).toEqual({
        status: "held",
        sendAfter: new Date("2026-09-20T22:00:00Z"),
      });
      expect(
        (await buildDigests(db, { render, now: DIGEST_TIME })).digests,
      ).toBe(1);
      expect((await statusOf(db, `news/1/${sam}`)).status).toBe("held");
    });
  });
});

describe("saveAlertLimits", () => {
  it("saves the person's choices and moves held messages to the new digest", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      expect(await alertLimitsFor(db, pat)).toEqual(DEFAULT_LIMITS);
      const weekly = {
        dailyCap: 0,
        digest: "weekly" as const,
        quietHours: { startHour: 23, endHour: 7 },
      };
      await saveAlertLimits(db, pat, weekly, { now: NOON, timeZone: TZ });
      expect(await alertLimitsFor(db, pat)).toEqual(weekly);

      await enqueueMessages(db, [news(pat, 1)]);
      await drainOutbox(db, {
        send: emails().send,
        render,
        now: NOON,
        timeZone: TZ,
      });
      expect((await statusOf(db, `news/1/${pat}`)).sendAfter).toEqual(
        new Date("2026-09-20T22:00:00Z"),
      );
      await saveAlertLimits(
        db,
        pat,
        { ...weekly, digest: "daily", quietHours: null },
        { now: NOON, timeZone: TZ },
      );
      expect(await alertLimitsFor(db, pat)).toMatchObject({
        digest: "daily",
        quietHours: null,
      });
      expect((await statusOf(db, `news/1/${pat}`)).sendAfter).toEqual(
        DIGEST_TIME,
      );
    });
  });

  it("refuses limits the database does not allow", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await expect(
        saveAlertLimits(
          db,
          pat,
          { ...DEFAULT_LIMITS, dailyCap: 9 },
          { now: NOON, timeZone: TZ },
        ),
      ).rejects.toThrow();
    });
  });
});

describe("account deletion", () => {
  it("removes the person's alert limits, held messages and digests", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await saveAlertLimits(
        db,
        pat,
        { ...DEFAULT_LIMITS, dailyCap: 0 },
        { now: NOON, timeZone: TZ },
      );
      await enqueueMessages(db, [news(pat, 1), news(pat, 2)]);
      await drainOutbox(db, {
        send: emails().send,
        render,
        now: NOON,
        timeZone: TZ,
      });
      await buildDigests(db, { render, now: DIGEST_TIME });
      await enqueueMessages(db, [news(pat, 3)]);
      await drainOutbox(db, {
        send: emails().send,
        render,
        now: NOON,
        timeZone: TZ,
      });
      expect((await personalData(db, pat, NOON))?.alertLimits).toMatchObject({
        dailyCap: 0,
        quietStartHour: 22,
      });

      await deleteAccount(db, pat, NOON);
      expect(await alertLimitsFor(db, pat)).toEqual(DEFAULT_LIMITS);
      expect(await rowsOf(db, pat)).toEqual([]);
    });
  });
});
