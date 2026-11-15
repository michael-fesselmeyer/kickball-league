import { afterAll, describe, expect, it } from "vitest";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  emailSettingsOf,
  saveEmailSettings,
  startWithNewsOff,
} from "./notifications";
import { drainOutbox, enqueueMessages } from "./outbox";

afterAll(closePool);

const NOW = new Date("2026-09-14T15:00:00Z");
const render = rendererFor({ siteUrl: "https://league.example.test" });

const enabled = async (
  db: Parameters<typeof emailSettingsOf>[0],
  userId: Parameters<typeof emailSettingsOf>[1],
) =>
  Object.fromEntries(
    (await emailSettingsOf(db, userId)).map((s) => [s.topic, s.enabled]),
  );

describe("league news is opt-in (#331)", () => {
  it("starts a new account with announcements off and everything urgent on", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const newcomer = await w.person("newcomer");
      await startWithNewsOff(db, newcomer.userId);
      const on = await enabled(db, newcomer.userId);
      expect(on["announcement"]).toBe(false);
      // Game messages and payments stay as they were.
      for (const topic of ["rainout", "sub_request", "payment", "score"])
        expect(on[topic]).toBe(true);
    });
  });

  it("leaves existing accounts as they are, and never overwrites a saved choice", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      // Someone who never changed a setting keeps getting announcements.
      expect((await enabled(db, w.aces.captain.userId))["announcement"]).toBe(
        true,
      );
      // Someone who turned them on keeps them on.
      const chose = await w.person("chose-news");
      await saveEmailSettings(db, chose.userId, new Set(["announcement"]));
      await startWithNewsOff(db, chose.userId);
      expect((await enabled(db, chose.userId))["announcement"]).toBe(true);
    });
  });

  it("sends a new account the rain-out but not the announcement, until they turn news on", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const newcomer = await w.person("newcomer-mail");
      await startWithNewsOff(db, newcomer.userId);
      await enqueueMessages(db, [
        {
          userId: newcomer.userId,
          topic: "announcement",
          template: "announcement",
          payload: {
            subject: "Season recap",
            body: "Here's how the week went.",
            from: "League admins",
            seasonName: "Fall",
            seasonSlug: "fall",
          },
          dedupeKey: `news-opt-in/news/${w.tag}`,
          sendAfter: NOW,
        },
        {
          userId: newcomer.userId,
          topic: "rainout",
          template: "rainout_notice",
          payload: {
            was: "Sun, Sep 13, 7:00 PM, Field 2",
            teams: "Aces vs Bees",
            makeup: "Sun, Sep 20, 7:00 PM, Field 2",
            seasonName: "Fall",
            seasonSlug: "fall",
          },
          dedupeKey: `news-opt-in/rain/${w.tag}`,
          sendAfter: NOW,
        },
      ]);
      const sent: Email[] = [];
      const send: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `email-${sent.length}` });
      };
      await drainOutbox(db, { send, render, now: NOW });
      const mine = sent.filter((e) => e.to === newcomer.email);
      expect(mine.map((e) => e.subject)).toEqual([
        expect.stringContaining("Rain"),
      ]);
    });
  });
});
