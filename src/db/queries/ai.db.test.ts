import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { aiUsage, recapDraft } from "../schema/ai";
import { auditLog } from "../schema/audit";
import { league } from "../schema/league";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  monthSpend,
  reserveAiCall,
  saveRecapDraft,
  savedRecapDraft,
  setAiBudget,
  settleAiCall,
} from "./ai";

afterAll(closePool);

const NOW = new Date("2026-11-13T18:00:00Z");
const USAGE = {
  inputTokens: 3_000,
  outputTokens: 800,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

describe("AI spend", () => {
  it("reserves the worst case, then settles to the real cost", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const reserved = await reserveAiCall(db, {
        leagueId: w.leagueId,
        feature: "recap",
        model: "claude-opus-5-5",
        worstCaseMicrodollars: 112_000,
        actorId: w.admin,
        now: NOW,
      });
      if (!reserved.ok) throw new Error(reserved.error);
      expect(await monthSpend(db, w.leagueId, NOW)).toBe(112_000);

      await settleAiCall(db, reserved.value, {
        usage: USAGE,
        costMicrodollars: 28_000,
        outcome: "accepted",
      });
      expect(await monthSpend(db, w.leagueId, NOW)).toBe(28_000);
      const [row] = await db
        .select()
        .from(aiUsage)
        .where(eq(aiUsage.id, reserved.value));
      expect(row).toMatchObject({
        feature: "recap",
        model: "claude-opus-5-5",
        inputTokens: 3_000,
        outputTokens: 800,
        outcome: "accepted",
        actorId: w.admin,
      });
    }));

  it("counts only this calendar month", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const row = {
        leagueId: w.leagueId,
        feature: "recap",
        model: "claude-opus-5-5",
        inputTokens: 1,
        outputTokens: 1,
        outcome: "accepted",
      };
      await db.insert(aiUsage).values([
        {
          ...row,
          costMicrodollars: 900_000,
          createdAt: new Date("2026-10-31T23:59:59Z"),
        },
        {
          ...row,
          costMicrodollars: 40_000,
          createdAt: new Date("2026-11-01T00:00:00Z"),
        },
      ]);
      expect(await monthSpend(db, w.leagueId, NOW)).toBe(40_000);
    }));

  it("refuses a reservation that would pass the budget", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await db
        .update(league)
        .set({ aiMonthlyBudgetCents: 20 })
        .where(eq(league.id, w.leagueId));
      const reserve = () =>
        reserveAiCall(db, {
          leagueId: w.leagueId,
          feature: "recap",
          model: "claude-opus-5-5",
          worstCaseMicrodollars: 112_000,
          actorId: w.admin,
          now: NOW,
        });
      expect((await reserve()).ok).toBe(true);
      expect(await reserve()).toEqual({ ok: false, error: "over_budget" });
      expect(await monthSpend(db, w.leagueId, NOW)).toBe(112_000);
    }));

  it("refuses bad outcomes and negative costs", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const row = {
        leagueId: w.leagueId,
        feature: "recap",
        model: "claude-opus-5-5",
        inputTokens: 0,
        outputTokens: 0,
        costMicrodollars: 0,
        outcome: "accepted",
      };
      await expect(
        db.transaction((tx) =>
          tx.insert(aiUsage).values({ ...row, outcome: "maybe" }),
        ),
      ).rejects.toThrow();
      await expect(
        db.transaction((tx) =>
          tx.insert(aiUsage).values({ ...row, costMicrodollars: -1 }),
        ),
      ).rejects.toThrow();
    }));

  it("lets the operator set the budget, with an audit row", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await setAiBudget(db, {
        leagueId: w.leagueId,
        budgetCents: 1_250,
        actorId: w.admin,
      });
      const [lg] = await db
        .select({ cents: league.aiMonthlyBudgetCents })
        .from(league)
        .where(eq(league.id, w.leagueId));
      expect(lg?.cents).toBe(1_250);
      const audit = await db
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, w.leagueId),
            eq(auditLog.action, "operator.ai_budget"),
          ),
        );
      expect(audit).toEqual([
        { before: { budgetCents: 500 }, after: { budgetCents: 1_250 } },
      ]);
      await expect(
        db.transaction((tx) =>
          tx
            .update(league)
            .set({ aiMonthlyBudgetCents: -1 })
            .where(eq(league.id, w.leagueId)),
        ),
      ).rejects.toThrow();
    }));
});

describe("saved AI recap drafts", () => {
  it("keeps one draft per game day, the newest", () =>
    inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const draft = {
        seasonId: w.season.id,
        day: "2026-11-09",
        model: "claude-opus-5-5" as const,
        createdBy: w.admin,
        now: NOW,
      };
      expect(await savedRecapDraft(db, w.season.id, "2026-11-09")).toBeNull();
      await saveRecapDraft(db, { ...draft, subject: "First", body: "One" });
      await saveRecapDraft(db, { ...draft, subject: "Second", body: "Two" });
      expect(
        await savedRecapDraft(db, w.season.id, "2026-11-09"),
      ).toMatchObject({ subject: "Second", body: "Two" });
      expect(
        await db
          .select({ id: recapDraft.id })
          .from(recapDraft)
          .where(eq(recapDraft.seasonId, w.season.id)),
      ).toHaveLength(1);
      expect(await savedRecapDraft(db, w.season.id, "2026-11-16")).toBeNull();
    }));
});
