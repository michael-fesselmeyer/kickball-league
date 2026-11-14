import { afterAll, describe, expect, it } from "vitest";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import { readUnsubscribeToken } from "@/lib/unsubscribe";
import type { Email, EmailSender } from "@/services/email";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { emailSettingsOf, turnOffEmailTopic } from "./notifications";
import { drainOutbox, enqueueMessages } from "./outbox";

afterAll(closePool);

const SECRET = "test-secret-not-used-anywhere-0000000000";
const NOW = new Date("2026-09-14T15:00:00Z");

describe("one-click unsubscribe", () => {
  it("puts the person's link for the email's topic in the footer and the headers", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const to = w.aces.captain;
      await enqueueMessages(db, [
        {
          userId: to.userId,
          topic: "score",
          template: "score_confirmation",
          payload: {
            gameId: "g1",
            teams: "Aces vs Bees",
            when: "Sun, Sep 13, 7:00 PM, Field 2",
            reportedBy: "Bees",
            result: "Aces 7, Bees 4",
          },
          dedupeKey: `unsubscribe-test/${w.tag}`,
          sendAfter: NOW,
        },
      ]);
      const sent: Email[] = [];
      const send: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `email-${sent.length}` });
      };
      await drainOutbox(db, {
        send,
        render: rendererFor({
          siteUrl: "https://league.example.test",
          unsubscribeSecret: SECRET,
        }),
        now: NOW,
      });
      const email = sent.find((e) => e.to === to.email);
      expect(email?.text).toMatch(
        /Stop emails about scores: https:\/\/league\.example\.test\/unsubscribe\//,
      );
      expect(email?.html).toContain("Stop emails about scores");
      const header = email?.headers?.["List-Unsubscribe"] ?? "";
      expect(header).toMatch(
        /^<https:\/\/league\.example\.test\/api\/unsubscribe\/.+>$/,
      );
      expect(email?.headers?.["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
      );

      // The header's link turns that topic off for that person only.
      const token = header.slice(1, -1).split("/").at(-1) ?? "";
      const found = readUnsubscribeToken(SECRET, token);
      expect(found).toEqual({ userId: to.userId, topic: "score" });
      await turnOffEmailTopic(db, found!.userId, found!.topic);
      await turnOffEmailTopic(db, found!.userId, found!.topic);
      const settings = await emailSettingsOf(db, to.userId);
      expect(settings.find((s) => s.topic === "score")?.enabled).toBe(false);
      expect(settings.find((s) => s.topic === "rainout")?.enabled).toBe(true);
    });
  });
});
