import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { ConcernInput } from "@/domain/concerns/concerns";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { auditLog } from "../schema/audit";
import { concern } from "../schema/concern";
import { message } from "../schema/message";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  addConcernMessage,
  closeConcern,
  concernDetail,
  concernQueue,
  purgeConcernEmails,
  reopenConcern,
  submitConcern,
} from "./concerns";
import { drainOutbox } from "./outbox";
import { required } from "./rows";

afterAll(closePool);

const NOW = new Date("2027-04-05T16:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);
const render = rendererFor({ siteUrl: "https://league.example.test" });
const form = (over: Partial<ConcernInput> = {}): ConcernInput => ({
  category: "park_rules",
  parkRule: "amplified_sound",
  body: "Music from the field after 9pm.",
  occurredOn: null,
  place: "Field 2",
  replyEmail: "neighbor@example.test",
  ...over,
});

function recorder() {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `provider-${sent.length}` });
  };
  return { sent, send };
}

describe("public concerns", () => {
  it("saves a message with no sender, audits it without the text, and emails an acknowledgement to the address", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const id = await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "public",
        senderId: null,
        form: form(),
        now: NOW,
      });
      const [row] = await db.select().from(concern).where(eq(concern.id, id));
      expect(row).toMatchObject({
        source: "public",
        senderId: null,
        replyEmail: "neighbor@example.test",
        parkRule: "amplified_sound",
        status: "open",
      });
      const audit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit.map((a) => a.action)).toEqual(["concern.send"]);
      expect(JSON.stringify(audit)).not.toContain("neighbor@example.test");
      expect(JSON.stringify(audit)).not.toContain("Music from");

      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: NOW });
      expect(sent.map((e) => e.to)).toEqual(["neighbor@example.test"]);
      expect(sent[0]?.subject).toBe("We got your message");
    });
  });

  it("sends nothing when no address was given, and a signed-in sender gets email at their account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "public",
        senderId: null,
        form: form({ replyEmail: null }),
        now: NOW,
      });
      const player = required(w.aces.players[0], "a player");
      await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "player",
        senderId: player.userId,
        form: form({ replyEmail: "ignored@example.test" }),
        now: NOW,
      });
      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: NOW });
      expect(sent.map((e) => e.to)).toEqual([player.email]);
      // A player's concern never stores the address typed on a public form.
      const rows = await db.select().from(concern);
      expect(rows.find((r) => r.source === "player")?.replyEmail).toBeNull();
    });
  });
});

describe("working a concern", () => {
  it("records the first reply once, emails each reply, closes with an outcome and tells the sender", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = w.aces.captain.userId;
      const id = await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "public",
        senderId: null,
        form: form(),
        now: NOW,
      });
      expect(
        await addConcernMessage(db, {
          concernId: id,
          authorId: admin,
          kind: "note",
          body: "Checking the permit.",
          leagueName: "Test League",
          now: hours(1),
        }),
      ).toEqual(ok(undefined));
      let [row] = await db.select().from(concern).where(eq(concern.id, id));
      expect(row?.firstRepliedAt).toBeNull();

      await addConcernMessage(db, {
        concernId: id,
        authorId: admin,
        kind: "reply",
        body: "Thanks, we spoke to the team.",
        leagueName: "Test League",
        now: hours(5),
      });
      await addConcernMessage(db, {
        concernId: id,
        authorId: admin,
        kind: "reply",
        body: "One more thing.",
        leagueName: "Test League",
        now: hours(30),
      });
      [row] = await db.select().from(concern).where(eq(concern.id, id));
      expect(row?.firstRepliedAt).toEqual(hours(5));

      const closed = await closeConcern(db, {
        concernId: id,
        actorId: admin,
        outcome: "Reminded the team about quiet hours.",
        leagueName: "Test League",
        now: hours(31),
      });
      expect(closed).toEqual(ok(undefined));
      expect(
        await closeConcern(db, {
          concernId: id,
          actorId: admin,
          outcome: "again",
          leagueName: "Test League",
          now: hours(32),
        }),
      ).toEqual({ ok: false, error: "closed" });
      // Nothing can be added to a closed concern until it is reopened.
      expect(
        await addConcernMessage(db, {
          concernId: id,
          authorId: admin,
          kind: "note",
          body: "late",
          leagueName: "Test League",
          now: hours(33),
        }),
      ).toEqual({ ok: false, error: "closed" });

      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: hours(40) });
      expect(sent.map((e) => e.subject).sort()).toEqual([
        "A reply from the league",
        "A reply from the league",
        "We got your message",
        "Your message is closed",
      ]);
      // Notes are for admins: never emailed.
      expect(sent.map((e) => e.text).join("\n")).not.toContain("permit");

      const queue = await concernQueue(db, w.leagueId, hours(40));
      expect(queue.open).toHaveLength(0);
      expect(queue.closed).toHaveLength(1);
      expect(queue.answeredInDay).toEqual({ total: 1, quick: 1 });

      expect(
        await reopenConcern(db, { concernId: id, actorId: admin }),
      ).toEqual(ok(undefined));
    });
  });

  it("cannot reply to a sender who left no address, and audits each reader of an address", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = w.aces.captain.userId;
      const silent = await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "public",
        senderId: null,
        form: form({ replyEmail: null }),
        now: NOW,
      });
      expect(
        await addConcernMessage(db, {
          concernId: silent,
          authorId: admin,
          kind: "reply",
          body: "Hello?",
          leagueName: "Test League",
          now: hours(1),
        }),
      ).toEqual({ ok: false, error: "no_reply_to" });
      // No address to read, so no read entry.
      await concernDetail(db, silent, admin);

      const withAddress = await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "public",
        senderId: null,
        form: form(),
        now: NOW,
      });
      await concernDetail(db, withAddress, admin);
      const reads = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "concern.read"));
      expect(reads.map((r) => [r.entityId, r.actorId])).toEqual([
        [withAddress, admin],
      ]);
    });
  });
});

describe("keeping addresses", () => {
  it("clears the address and its queued emails 12 months after closing, not before", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = w.aces.captain.userId;
      const id = await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "public",
        senderId: null,
        form: form(),
        now: NOW,
      });
      const stillOpen = await submitConcern(db, {
        leagueId: w.leagueId,
        leagueName: "Test League",
        source: "public",
        senderId: null,
        form: form({ replyEmail: "other@example.test" }),
        now: NOW,
      });
      await closeConcern(db, {
        concernId: id,
        actorId: admin,
        outcome: "Done.",
        leagueName: "Test League",
        now: NOW,
      });
      expect(await purgeConcernEmails(db, hours(24 * 364))).toBe(0);
      expect(await purgeConcernEmails(db, hours(24 * 367))).toBe(1);
      const rows = await db.select().from(concern);
      expect(rows.find((r) => r.id === id)?.replyEmail).toBeNull();
      // A concern still open keeps its address however old it is.
      expect(rows.find((r) => r.id === stillOpen)?.replyEmail).toBe(
        "other@example.test",
      );
      const queued = await db
        .select({ key: message.dedupeKey, to: message.recipientEmail })
        .from(message);
      expect(queued.map((m) => m.to).sort()).toEqual(["other@example.test"]);
    });
  });
});
