import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { message } from "../schema/message";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import { queuePaymentReminders } from "./payment-reminders";
import type { Db } from "./schedule";

afterAll(closePool);

// Friday 2026-09-11 at 23:59 in New York, the seed league's zone.
const DEADLINE = new Date("2026-09-12T03:59:00Z");
/** 10:00 New York time on the given September day. */
const at = (day: number, hour = 14) =>
  new Date(
    `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`,
  );
const render = rendererFor({ siteUrl: "https://league.example.test" });

function recorder() {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `provider-${sent.length}` });
  };
  return { sent, send };
}

const reminders = (db: Db) =>
  db
    .select({ key: message.dedupeKey, payload: message.payload })
    .from(message)
    .where(like(message.dedupeKey, "payment-reminder/%"));

describe("queuePaymentReminders", () => {
  it("reminds every unpaid player once per milestone, however often it runs", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db, { paymentDeadlineAt: DEADLINE });
      const unpaid = [
        w.aces.players[1],
        w.bees.players[0],
        w.bees.players[1],
        w.freeAgent,
      ].map((p) => p?.email);

      // Eight days out: nothing yet.
      expect(await queuePaymentReminders(db, at(3))).toBe(0);
      // Seven days out, run twice.
      expect(await queuePaymentReminders(db, at(4))).toBe(4);
      expect(await queuePaymentReminders(db, at(4, 15))).toBe(0);
      // Still in the seven-day window the next day.
      expect(await queuePaymentReminders(db, at(5))).toBe(0);

      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: at(4) });
      expect(sent.map((e) => e.to).sort()).toEqual(unpaid.sort());
      expect(sent[0]?.subject).toBe("Your Fall 2026 fee is due in 7 days");

      // Three days and one day out; the deadline day itself sends nothing new.
      expect(await queuePaymentReminders(db, at(8))).toBe(4);
      expect(await queuePaymentReminders(db, at(10))).toBe(4);
      expect(await queuePaymentReminders(db, at(11))).toBe(0);
      // After the deadline, nothing.
      expect(await queuePaymentReminders(db, at(12))).toBe(0);
      expect(await reminders(db)).toHaveLength(12);
    });
  });

  it("stops reminding someone who pays", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db, { paymentDeadlineAt: DEADLINE });
      await queuePaymentReminders(db, at(4));
      await db
        .update(registration)
        .set({ status: "active" })
        .where(eq(registration.id, w.freeAgent.registrationId));
      expect(await queuePaymentReminders(db, at(8))).toBe(3);
    });
  });

  it("asks someone who has not signed the waiver to do that first", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db, { paymentDeadlineAt: DEADLINE });
      await queuePaymentReminders(db, at(10));
      const { sent, send } = recorder();
      await drainOutbox(db, { send, render, now: at(10) });
      const waiver = sent.find((e) => e.to === w.bees.players[1]?.email);
      expect(waiver?.subject).toBe("Your Fall 2026 fee is due tomorrow");
      expect(waiver?.text).toContain("Sign the season waiver first");
      expect(waiver?.text).toContain("Friday, September 11 at 11:59 PM");
    });
  });

  it("starts over when the deadline moves", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db, { paymentDeadlineAt: DEADLINE });
      expect(await queuePaymentReminders(db, at(8))).toBe(4);
      await db
        .update(season)
        .set({ paymentDeadlineAt: new Date("2026-09-19T03:59:00Z") })
        .where(eq(season.id, w.season.id));
      expect(await queuePaymentReminders(db, at(12))).toBe(4);
    });
  });
});
