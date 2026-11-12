import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { MAX_ATTEMPTS } from "@/domain/outbox/retry";
import { err, ok } from "@/domain/result";
import type { Email, EmailSender } from "@/services/email";
import * as schema from "../schema";
import { user } from "../schema/auth";
import { message, notificationPreference } from "../schema/message";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  claimDueMessages,
  drainOutbox,
  emptyDrain,
  enqueueMessages,
  type OutboxMessage,
  type Renderer,
} from "./outbox";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-14T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const render: Renderer = (template, payload) =>
  template === "hello"
    ? ok({
        subject: `Hello ${String(payload.name)}`,
        html: "<p>Hi</p>",
        text: "Hi",
      })
    : err(`Unknown template ${template}`);

/** A sender that records what it was asked to send and answers as told. */
function recorder(answer: (email: Email) => boolean = () => true) {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return answer(email)
      ? ok({ id: `provider-${sent.length}` })
      : err("Resend refused the email (500): try later");
  };
  return { sent, send };
}

async function person(db: Db): Promise<UserId> {
  const tag = Math.random().toString(36).slice(2, 10);
  const [row] = await db
    .insert(user)
    .values({ name: "Pat", email: `outbox-${tag}@example.test` })
    .returning({ id: user.id });
  return required(row, "user").id;
}

const hello = (
  userId: UserId,
  key: string,
  sendAfter = NOW,
): OutboxMessage => ({
  userId,
  topic: "announcement",
  template: "hello",
  payload: { name: "Pat" },
  dedupeKey: key,
  sendAfter,
});

const rowsOf = (db: Db, userId: UserId) =>
  db.select().from(message).where(eq(message.userId, userId));

describe("enqueueMessages", () => {
  it("skips a message whose dedupe key is already queued", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      expect(await enqueueMessages(db, [hello(pat, "k1")])).toBe(1);
      expect(
        await enqueueMessages(db, [hello(pat, "k1"), hello(pat, "k2")]),
      ).toBe(1);
      expect(await rowsOf(db, pat)).toHaveLength(2);
    });
  });

  it("writes nothing when the change that caused it rolls back", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await db
        .transaction(async (tx) => {
          await enqueueMessages(tx, [hello(pat, "rolled-back")]);
          tx.rollback();
        })
        .catch(() => undefined);
      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: NOW });
      expect(sent).toHaveLength(0);
      expect(await rowsOf(db, pat)).toHaveLength(0);
    });
  });
});

describe("drainOutbox", () => {
  it("sends due messages once, keyed by message id, and waits for later ones", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await enqueueMessages(db, [
        hello(pat, "now"),
        hello(pat, "later", later(60)),
      ]);
      const { sent, send } = recorder();
      expect(await drainOutbox(db, { send, render, now: NOW })).toEqual({
        ...emptyDrain(),
        sent: 1,
      });
      expect(await drainOutbox(db, { send, render, now: NOW })).toEqual(
        emptyDrain(),
      );
      const rows = await rowsOf(db, pat);
      const done = required(
        rows.find((r) => r.dedupeKey === "now"),
        "sent message",
      );
      expect(done).toMatchObject({
        status: "sent",
        attempts: 1,
        providerMessageId: "provider-1",
        lockedUntil: null,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        subject: "Hello Pat",
        idempotencyKey: `message/${done.id}`,
      });
      expect(rows.find((r) => r.dedupeKey === "later")?.status).toBe("queued");

      await drainOutbox(db, { send, render, now: later(60) });
      expect(sent).toHaveLength(2);
    });
  });

  it("retries a refused message with backoff, then gives up", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await enqueueMessages(db, [hello(pat, "flaky")]);
      const { sent, send } = recorder(() => false);

      expect(await drainOutbox(db, { send, render, now: NOW })).toMatchObject({
        retrying: 1,
      });
      const [first] = await rowsOf(db, pat);
      expect(first).toMatchObject({
        status: "queued",
        attempts: 1,
        sendAfter: later(1),
        lastError: "Resend refused the email (500): try later",
      });
      // Not due again until the backoff has passed.
      await drainOutbox(db, { send, render, now: NOW });
      expect(sent).toHaveLength(1);

      let at = NOW;
      for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
        at = required((await rowsOf(db, pat))[0], "message").sendAfter;
        await drainOutbox(db, { send, render, now: at });
      }
      expect(sent).toHaveLength(MAX_ATTEMPTS);
      expect((await rowsOf(db, pat))[0]).toMatchObject({
        status: "failed",
        attempts: MAX_ATTEMPTS,
      });
      await drainOutbox(db, { send, render, now: later(24 * 60) });
      expect(sent).toHaveLength(MAX_ATTEMPTS);
    });
  });

  it("succeeds on a retry after one refusal", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await enqueueMessages(db, [hello(pat, "second-time")]);
      let calls = 0;
      const { sent, send } = recorder(() => ++calls > 1);
      await drainOutbox(db, { send, render, now: NOW });
      await drainOutbox(db, { send, render, now: later(1) });
      expect(sent).toHaveLength(2);
      expect((await rowsOf(db, pat))[0]).toMatchObject({
        status: "sent",
        attempts: 2,
        lastError: null,
      });
    });
  });

  it("fails a message that cannot be built without sending it", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await enqueueMessages(db, [
        { ...hello(pat, "broken"), template: "missing" },
      ]);
      const { sent, send } = recorder();
      expect(await drainOutbox(db, { send, render, now: NOW })).toMatchObject({
        failed: 1,
      });
      expect(sent).toHaveLength(0);
      expect((await rowsOf(db, pat))[0]).toMatchObject({
        status: "failed",
        lastError: "Unknown template missing",
      });
    });
  });

  it("picks up a message whose worker stopped mid-send, with the same idempotency key", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await enqueueMessages(db, [hello(pat, "orphan")]);
      // A worker claims it and is never heard from again.
      const [claimed] = await claimDueMessages(db, NOW, 10);
      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: later(1) });
      expect(sent).toHaveLength(0);
      await drainOutbox(db, { send, render, now: later(6) });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.idempotencyKey).toBe(`message/${claimed?.id}`);
      expect((await rowsOf(db, pat))[0]).toMatchObject({
        status: "sent",
        attempts: 2,
      });
    });
  });
});

describe("preferences", () => {
  it("does not email a topic the person turned off, and says why", async () => {
    await inRolledBackDb(async (db) => {
      const pat = await person(db);
      await db.insert(notificationPreference).values({
        userId: pat,
        topic: "announcement",
        channel: "email",
        enabled: false,
      });
      await enqueueMessages(db, [
        hello(pat, "muted"),
        { ...hello(pat, "payment"), topic: "payment" },
      ]);
      const { sent, send } = recorder();
      expect(await drainOutbox(db, { send, render, now: NOW })).toMatchObject({
        sent: 1,
        suppressed: 1,
      });
      expect(sent).toHaveLength(1);
      const muted = (await rowsOf(db, pat)).find(
        (r) => r.dedupeKey === "muted",
      );
      expect(muted).toMatchObject({
        status: "suppressed",
        suppressReason: "opted_out",
      });
    });
  });
});

describe("two drains at once", () => {
  it("send each message exactly once", async () => {
    // Real commits on two connections: rolled-back transactions cannot show
    // what a second worker sees. Everything is deleted afterwards.
    const clients: Client[] = [];
    const connect = async () => {
      const client = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await client.connect();
      clients.push(client);
      return drizzle({ client, schema, casing: "snake_case" });
    };
    const setup = await connect();
    const pat = await person(setup);
    try {
      const keys = Array.from({ length: 30 }, (_, i) => `race-${pat}-${i}`);
      await enqueueMessages(
        setup,
        keys.map((k) => hello(pat, k)),
      );
      const [a, b] = await Promise.all([connect(), connect()]);
      const { sent, send } = recorder();
      // Small batches, so the two workers interleave.
      const drainAll = async (db: Db) => {
        while (
          (await drainOutbox(db, { send, render, now: NOW, limit: 3 })).sent > 0
        );
      };
      await Promise.all([drainAll(a), drainAll(b)]);
      const keysSent = sent.map((e) => e.idempotencyKey);
      expect(keysSent).toHaveLength(30);
      expect(new Set(keysSent).size).toBe(30);
      const rows = await setup
        .select({ status: message.status })
        .from(message)
        .where(inArray(message.dedupeKey, keys));
      expect(rows.every((r) => r.status === "sent")).toBe(true);
    } finally {
      await setup.delete(user).where(eq(user.id, pat));
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
