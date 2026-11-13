import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { message } from "../schema/message";
import { rosterMembership } from "../schema/team";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import type { Db } from "./schedule";
import { reportScore } from "./scores";

afterAll(closePool);

const ENDS = new Date("2026-09-14T00:00:00Z");
const after = (minutes: number) => new Date(ENDS.getTime() + minutes * 60_000);
const render = rendererFor({ siteUrl: "https://league.example.test" });

const asked = async (db: Db) =>
  (
    await db
      .select({ userId: message.userId, payload: message.payload })
      .from(message)
      .where(like(message.dedupeKey, "score-confirm/%"))
  ).map((r) => r.userId);

const score = {
  outcome: "normal" as const,
  scoreA: 7,
  scoreB: 4,
  inningsPlayed: null,
};

describe("score confirmation requests", () => {
  it("asks the other team's captains to confirm a captain's report, once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const co = w.bees.players[0];
      if (!co) throw new Error("missing player");
      await db
        .update(rosterMembership)
        .set({ role: "co_captain" })
        .where(eq(rosterMembership.registrationId, co.registrationId));
      const { gameId } = await w.gameEnding(ENDS);
      const report = () =>
        reportScore(db, {
          gameId,
          userId: w.aces.captain.userId,
          role: "captain",
          teamSeasonId: w.aces.id,
          score,
          clientId: `confirm-${w.tag}`,
          now: after(5),
        });
      await report();
      await report();
      expect((await asked(db)).sort()).toEqual(
        [w.bees.captain.userId, co.userId].sort(),
      );

      const sent: Email[] = [];
      const send: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `email-${sent.length}` });
      };
      await drainOutbox(db, { send, render, now: after(6) });
      expect(sent).toHaveLength(2);
      expect(sent[0]?.subject).toBe("Confirm the score: Aces 7, Bees 4");
      expect(sent[0]?.text).toContain(
        "Aces reported Aces 7, Bees 4 for Aces vs Bees",
      );
      expect(sent[0]?.text).toContain(`/app/games/${gameId}/score`);
    });
  });

  it("asks both teams' captains about a ref's report", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const ref = await w.person("ref");
      const { gameId } = await w.gameEnding(ENDS, ref.userId);
      await reportScore(db, {
        gameId,
        userId: ref.userId,
        role: "referee",
        teamSeasonId: null,
        score: {
          outcome: "forfeit_b",
          scoreA: 0,
          scoreB: 0,
          inningsPlayed: null,
        },
        clientId: `ref-${w.tag}`,
        now: after(5),
      });
      expect((await asked(db)).sort()).toEqual(
        [w.aces.captain.userId, w.bees.captain.userId].sort(),
      );
      const [row] = await db
        .select({ payload: message.payload })
        .from(message)
        .where(like(message.dedupeKey, "score-confirm/%"));
      expect(row?.payload).toMatchObject({
        reportedBy: "The ref",
        result: "Bees forfeited",
      });
    });
  });

  it("asks nobody when an admin's score is final at once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = await w.person("admin");
      const { gameId } = await w.gameEnding(ENDS);
      await reportScore(db, {
        gameId,
        userId: admin.userId,
        role: "admin",
        teamSeasonId: null,
        score,
        clientId: `admin-${w.tag}`,
        now: after(5),
      });
      expect(await asked(db)).toEqual([]);
    });
  });
});
