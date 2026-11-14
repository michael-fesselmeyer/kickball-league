import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { ScoreReportId } from "@/domain/ids";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { rosterMembership } from "../schema/team";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import type { Db } from "./schedule";
import { reportScore, respondToScore } from "./scores";

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

  it("tells every admin once when a captain disputes the score", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = await w.person("league-admin");
      const owner = await w.person("league-owner");
      await db.insert(profile).values([
        { userId: admin.userId, globalRole: "admin" },
        { userId: owner.userId, globalRole: "owner" },
      ]);
      const { gameId } = await w.gameEnding(ENDS);
      const reported = await reportScore(db, {
        gameId,
        userId: w.aces.captain.userId,
        role: "captain",
        teamSeasonId: w.aces.id,
        score,
        clientId: `dispute-${w.tag}`,
        now: after(5),
      });
      if (!reported.ok || !("reportId" in reported.value))
        throw new Error("no report");
      const reportId = reported.value.reportId as ScoreReportId;
      const dispute = () =>
        respondToScore(db, {
          gameId,
          reportId,
          teamSeasonId: w.bees.id,
          userId: w.bees.captain.userId,
          status: "disputed",
          note: "We had it 5-7",
          now: after(30),
        });
      expect((await dispute()).ok).toBe(true);
      await dispute(); // a retried submit
      const alerts = await db
        .select({ userId: message.userId, topic: message.topic })
        .from(message)
        .where(like(message.dedupeKey, "score-dispute/%"));
      const told = alerts.map((a) => a.userId);
      expect(told).toEqual(
        expect.arrayContaining([admin.userId, owner.userId]),
      );
      expect(new Set(told).size).toBe(told.length);
      expect(told).not.toContain(w.aces.captain.userId);
      expect(alerts.every((a) => a.topic === "score")).toBe(true);

      const sent: Email[] = [];
      const send: EmailSender = async (email) => {
        sent.push(email);
        return ok({ id: `email-${sent.length}` });
      };
      await drainOutbox(db, { send, render, now: after(31) });
      const toAdmin = sent.find((e) => e.to === admin.email);
      expect(toAdmin?.subject).toBe("Score disputed: Aces vs Bees");
      expect(toAdmin?.text).toContain(
        "Bees disputed the score Aces reported for Aces vs Bees",
      );
      expect(toAdmin?.text).toContain("We had it 5-7");
      expect(toAdmin?.text).toContain("/scores");
    });
  });

  it("tells no admin when a captain confirms", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const { gameId } = await w.gameEnding(ENDS);
      const reported = await reportScore(db, {
        gameId,
        userId: w.aces.captain.userId,
        role: "captain",
        teamSeasonId: w.aces.id,
        score,
        clientId: `confirmed-${w.tag}`,
        now: after(5),
      });
      if (!reported.ok || !("reportId" in reported.value))
        throw new Error("no report");
      await respondToScore(db, {
        gameId,
        reportId: reported.value.reportId as ScoreReportId,
        teamSeasonId: w.bees.id,
        userId: w.bees.captain.userId,
        status: "confirmed",
        note: "",
        now: after(30),
      });
      const alerts = await db
        .select({ id: message.id })
        .from(message)
        .where(like(message.dedupeKey, "score-dispute/%"));
      expect(alerts).toEqual([]);
    });
  });
});
