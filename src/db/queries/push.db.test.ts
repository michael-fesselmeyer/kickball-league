import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import {
  recordedPushEndpoint,
  type TestDevice,
  testDevice,
} from "@/lib/push/test-device";
import { generateVapidKeys } from "@/lib/push/web-push";
import type { Email, EmailSender } from "@/services/email";
import { webPushSender } from "@/services/push";
import { user } from "../schema/auth";
import { message, pushSubscription } from "../schema/message";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  drainOutbox,
  enqueueMessages,
  type OutboxMessage,
  pushKey,
} from "./outbox";
import {
  pushSettingsOf,
  removePushSubscription,
  savePushSettings,
  savePushSubscription,
} from "./push";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-14T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const render = rendererFor({ siteUrl: "https://league.example.test" });
const vapid = { ...generateVapidKeys(), subject: "mailto:league@example.test" };

function emails() {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `email-${sent.length}` });
  };
  return { sent, send };
}

async function person(db: Db): Promise<UserId> {
  const tag = Math.random().toString(36).slice(2, 10);
  const [row] = await db
    .insert(user)
    .values({ name: "Pat", email: `push-${tag}@example.test` })
    .returning({ id: user.id });
  return required(row, "user").id;
}

/** Subscribes a new test device for the person; returns it and its endpoint. */
async function phone(db: Db, userId: UserId) {
  const device = testDevice();
  const endpoint = `https://push.example.test/send/${Math.random().toString(36).slice(2)}`;
  await savePushSubscription(db, userId, {
    endpoint,
    keys: device.keys,
    userAgent: "Mozilla/5.0 (Android 15) Chrome",
  });
  return { device, endpoint };
}

const rainout = (
  userId: UserId,
  key = `rainout/g1/s1/${userId}`,
): OutboxMessage => ({
  userId,
  topic: "rainout",
  template: "rainout_notice",
  payload: {
    seasonName: "Fall 2026",
    seasonSlug: "fall-2026",
    teams: "Aces vs Bees",
    was: "Sun, Sep 13, 7:00 PM, Field 2",
    makeup: "Sun, Sep 20, 8:00 PM, Field 1",
  },
  dedupeKey: key,
  sendAfter: NOW,
});

const pushRows = (db: Db, userId: UserId) =>
  db
    .select()
    .from(message)
    .where(and(eq(message.userId, userId), eq(message.channel, "push")));

const devicesOf = (db: Db, userId: UserId) =>
  db
    .select({ endpoint: pushSubscription.endpoint })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, userId));

function endpointFor(
  phones: { device: TestDevice; endpoint: string }[],
  answer?: (endpoint: string) => number,
) {
  const recorded = recordedPushEndpoint(
    new Map(phones.map((p) => [p.endpoint, p.device])),
    answer,
  );
  return {
    ...recorded,
    push: webPushSender({ vapid, fetch: recorded.fetch, now: () => NOW }),
  };
}

describe("push settings", () => {
  it("is off for every topic until the person turns it on", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      expect(await pushSettingsOf(db, pat)).toEqual({
        devices: 0,
        topics: [
          expect.objectContaining({ topic: "rainout", enabled: false }),
          expect.objectContaining({ topic: "sub_request", enabled: false }),
          expect.objectContaining({ topic: "score", enabled: false }),
        ],
      });
      await phone(db, pat);
      await savePushSettings(db, pat, new Set(["rainout", "score", "payment"]));
      const settings = await pushSettingsOf(db, pat);
      expect(settings.devices).toBe(1);
      expect(settings.topics.map((t) => [t.topic, t.enabled])).toEqual([
        ["rainout", true],
        ["sub_request", false],
        ["score", true],
      ]);
      await savePushSettings(db, pat, new Set(["sub_request"]));
      expect(
        (await pushSettingsOf(db, pat)).topics.map((t) => t.enabled),
      ).toEqual([false, true, false]);
    });
  });

  it("moves a shared device to whoever subscribed it last, and forgets only your own", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const sam = await person(db);
      const { device, endpoint } = await phone(db, pat);
      await savePushSubscription(db, sam, {
        endpoint,
        keys: device.keys,
        userAgent: null,
      });
      expect(await devicesOf(db, pat)).toEqual([]);
      expect(await devicesOf(db, sam)).toEqual([{ endpoint }]);
      expect(await removePushSubscription(db, pat, endpoint)).toBe(false);
      expect(await removePushSubscription(db, sam, endpoint)).toBe(true);
      expect(await devicesOf(db, sam)).toEqual([]);
    });
  });
});

describe("enqueueMessages with push", () => {
  it("adds a push copy only for people with a device and that topic on", async () => {
    await inRolledBackDb(async (db) => {
      const on = await person(db);
      const noDevice = await person(db);
      const topicOff = await person(db);
      await phone(db, on);
      await savePushSettings(db, on, new Set(["rainout"]));
      await savePushSettings(db, noDevice, new Set(["rainout"]));
      await phone(db, topicOff);
      await savePushSettings(db, topicOff, new Set(["score"]));

      // The count is emails, as before.
      expect(
        await enqueueMessages(db, [
          rainout(on),
          rainout(noDevice),
          rainout(topicOff),
        ]),
      ).toBe(3);
      expect(await pushRows(db, on)).toMatchObject([
        {
          topic: "rainout",
          template: "rainout_notice",
          status: "queued",
          dedupeKey: pushKey(`rainout/g1/s1/${on}`),
        },
      ]);
      expect(await pushRows(db, noDevice)).toEqual([]);
      expect(await pushRows(db, topicOff)).toEqual([]);

      // Writing the same notice again adds no second push.
      expect(await enqueueMessages(db, [rainout(on)])).toBe(0);
      expect(await pushRows(db, on)).toHaveLength(1);
    });
  });

  it("never pushes an email-only topic", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await phone(db, pat);
      await savePushSettings(
        db,
        pat,
        new Set(["rainout", "sub_request", "score"]),
      );
      await enqueueMessages(db, [
        {
          ...rainout(pat, "pay/1"),
          topic: "payment",
          template: "payment_reminder",
        },
      ]);
      expect(await pushRows(db, pat)).toEqual([]);
    });
  });
});

describe("drainOutbox with push", () => {
  it("sends the email and an encrypted push to every device", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const a = await phone(db, pat);
      const b = await phone(db, pat);
      await savePushSettings(db, pat, new Set(["rainout"]));
      await enqueueMessages(db, [rainout(pat)]);

      const mail = emails();
      const endpoint = endpointFor([a, b]);
      expect(
        await drainOutbox(db, {
          send: mail.send,
          push: endpoint.push,
          render,
          now: NOW,
        }),
      ).toEqual({ sent: 2, retrying: 0, failed: 0, suppressed: 0 });
      expect(mail.sent).toHaveLength(1);
      const [row] = await pushRows(db, pat);
      const tag = required(row, "push row").id.replaceAll("-", "");
      expect(endpoint.received.map((r) => r.endpoint).sort()).toEqual(
        [a.endpoint, b.endpoint].sort(),
      );
      for (const got of endpoint.received) {
        expect(got.message).toEqual({
          title: "Your game has a new time",
          body: "Aces vs Bees (Sun, Sep 13, 7:00 PM, Field 2) is rained out.",
          path: "/app/seasons/fall-2026",
          tag,
        });
        expect(got.headers).toMatchObject({
          Urgency: "high",
          TTL: "86400",
          Topic: tag,
        });
      }
      expect(row).toMatchObject({ status: "sent", sentAt: NOW });
      const used = await db
        .select({ at: pushSubscription.lastSuccessAt })
        .from(pushSubscription)
        .where(eq(pushSubscription.userId, pat));
      expect(used).toEqual([{ at: NOW }, { at: NOW }]);
    });
  });

  it("removes a device the push service says is gone, and still sends to the rest", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const live = await phone(db, pat);
      const expired = await phone(db, pat);
      await savePushSettings(db, pat, new Set(["rainout"]));
      await enqueueMessages(db, [rainout(pat)]);
      const endpoint = endpointFor([live, expired], (e) =>
        e === expired.endpoint ? 410 : 201,
      );
      await drainOutbox(db, {
        send: null,
        push: endpoint.push,
        render,
        now: NOW,
      });
      expect(await devicesOf(db, pat)).toEqual([{ endpoint: live.endpoint }]);
      expect(await pushRows(db, pat)).toMatchObject([{ status: "sent" }]);
    });
  });

  it("suppresses the push when every device is gone", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const expired = await phone(db, pat);
      await savePushSettings(db, pat, new Set(["rainout"]));
      await enqueueMessages(db, [rainout(pat)]);
      const endpoint = endpointFor([expired], () => 404);
      expect(
        await drainOutbox(db, {
          send: null,
          push: endpoint.push,
          render,
          now: NOW,
        }),
      ).toMatchObject({ suppressed: 1 });
      expect(await devicesOf(db, pat)).toEqual([]);
      expect(await pushRows(db, pat)).toMatchObject([
        { status: "suppressed", suppressReason: "no_device" },
      ]);
    });
  });

  it("retries a push the service could not take, with the same topic", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const p = await phone(db, pat);
      await savePushSettings(db, pat, new Set(["rainout"]));
      await enqueueMessages(db, [rainout(pat)]);
      let status = 503;
      const endpoint = endpointFor([p], () => status);
      expect(
        await drainOutbox(db, {
          send: null,
          push: endpoint.push,
          render,
          now: NOW,
        }),
      ).toMatchObject({ retrying: 1 });
      expect(await pushRows(db, pat)).toMatchObject([
        {
          status: "queued",
          lastError: "The push service refused the message (503)",
        },
      ]);
      expect(await devicesOf(db, pat)).toHaveLength(1);
      status = 201;
      await drainOutbox(db, {
        send: null,
        push: endpoint.push,
        render,
        now: later(60),
      });
      expect(await pushRows(db, pat)).toMatchObject([
        { status: "sent", attempts: 2 },
      ]);
      const topics = endpoint.received.map((r) => r.headers.Topic);
      expect(topics).toHaveLength(2);
      expect(topics[0]).toBe(topics[1]);
    });
  });

  it("reads the choice at send time: turning a topic off stops a queued push", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      const p = await phone(db, pat);
      await savePushSettings(db, pat, new Set(["rainout"]));
      await enqueueMessages(db, [rainout(pat)]);
      await savePushSettings(db, pat, new Set());
      const endpoint = endpointFor([p]);
      await drainOutbox(db, {
        send: null,
        push: endpoint.push,
        render,
        now: NOW,
      });
      expect(endpoint.received).toEqual([]);
      expect(await pushRows(db, pat)).toMatchObject([
        { status: "suppressed", suppressReason: "opted_out" },
      ]);
    });
  });

  it("suppresses push when it is not configured, and leaves email queued without a sender", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await phone(db, pat);
      await savePushSettings(db, pat, new Set(["rainout"]));
      await enqueueMessages(db, [rainout(pat)]);
      expect(
        await drainOutbox(db, { send: null, push: null, render, now: NOW }),
      ).toMatchObject({ suppressed: 1 });
      expect(await pushRows(db, pat)).toMatchObject([
        { status: "suppressed", suppressReason: "push_off" },
      ]);
      const [email] = await db
        .select({ status: message.status })
        .from(message)
        .where(and(eq(message.userId, pat), eq(message.channel, "email")));
      expect(email).toEqual({ status: "queued" });
    });
  });
});
