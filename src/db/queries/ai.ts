import { and, asc, eq, gte, sql } from "drizzle-orm";
import { centsToMicrodollars, monthStart } from "@/domain/ai/budget";
import type { AiModel, TokenUsage } from "@/domain/ai/models";
import type { AiUsageId, LeagueId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { aiUsage, recapDraft } from "../schema/ai";
import { league } from "../schema/league";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/** The league's AI budget (one league per deployment). */
export async function aiBudget(
  db: Db,
): Promise<{ leagueId: LeagueId; budgetCents: number } | null> {
  const [row] = await db
    .select({ leagueId: league.id, budgetCents: league.aiMonthlyBudgetCents })
    .from(league)
    .orderBy(asc(league.createdAt))
    .limit(1);
  return row ?? null;
}

/** What the league's AI calls cost this calendar month (UTC), in microdollars. */
export async function monthSpend(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${aiUsage.costMicrodollars}), 0)`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.leagueId, leagueId),
        gte(aiUsage.createdAt, monthStart(now)),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * Reserves one call's worst-case cost before it is made. Locks the league
 * row, so two calls at once queue here and the second sees the first's
 * reservation. Run in a transaction, and commit before calling the model.
 */
export async function reserveAiCall(
  db: Db,
  input: {
    leagueId: LeagueId;
    feature: string;
    model: AiModel;
    worstCaseMicrodollars: number;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<AiUsageId, "over_budget">> {
  const [row] = await db
    .select({ budgetCents: league.aiMonthlyBudgetCents })
    .from(league)
    .where(eq(league.id, input.leagueId))
    .for("update");
  const spent = await monthSpend(db, input.leagueId, input.now);
  if (
    !row ||
    spent + input.worstCaseMicrodollars > centsToMicrodollars(row.budgetCents)
  )
    return err("over_budget");
  const [usage] = await db
    .insert(aiUsage)
    .values({
      leagueId: input.leagueId,
      feature: input.feature,
      model: input.model,
      inputTokens: 0,
      outputTokens: 0,
      costMicrodollars: input.worstCaseMicrodollars,
      outcome: "pending",
      actorId: input.actorId,
      createdAt: input.now,
    })
    .returning({ id: aiUsage.id });
  if (!usage) throw new Error("ai_usage insert returned no row");
  return ok(usage.id);
}

/** Replaces a reservation with what the call actually cost. */
export async function settleAiCall(
  db: Db,
  id: AiUsageId,
  input: {
    usage: TokenUsage;
    costMicrodollars: number;
    outcome: "accepted" | "rejected" | "failed";
  },
): Promise<void> {
  await db
    .update(aiUsage)
    .set({
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      costMicrodollars: input.costMicrodollars,
      outcome: input.outcome,
    })
    .where(eq(aiUsage.id, id));
}

/** The saved AI draft for one game day, if there is one. */
export async function savedRecapDraft(db: Db, seasonId: SeasonId, day: string) {
  const [row] = await db
    .select({
      subject: recapDraft.subject,
      body: recapDraft.body,
      createdAt: recapDraft.createdAt,
    })
    .from(recapDraft)
    .where(and(eq(recapDraft.seasonId, seasonId), eq(recapDraft.day, day)));
  return row ?? null;
}

/** Keeps the newest AI draft for a game day, replacing any older one. */
export async function saveRecapDraft(
  db: Db,
  input: {
    seasonId: SeasonId;
    day: string;
    subject: string;
    body: string;
    model: AiModel;
    createdBy: UserId;
    now: Date;
  },
): Promise<void> {
  const values = {
    subject: input.subject,
    body: input.body,
    model: input.model,
    createdBy: input.createdBy,
    createdAt: input.now,
  };
  await db
    .insert(recapDraft)
    .values({ seasonId: input.seasonId, day: input.day, ...values })
    .onConflictDoUpdate({
      target: [recapDraft.seasonId, recapDraft.day],
      set: values,
    });
}

/** The operator sets the monthly AI budget. Run in a transaction. */
export async function setAiBudget(
  db: Db,
  input: { leagueId: LeagueId; budgetCents: number; actorId: UserId },
): Promise<void> {
  const [before] = await db
    .select({ budgetCents: league.aiMonthlyBudgetCents })
    .from(league)
    .where(eq(league.id, input.leagueId))
    .for("update");
  await db
    .update(league)
    .set({ aiMonthlyBudgetCents: input.budgetCents })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "operator.ai_budget",
    entityType: "league",
    entityId: input.leagueId,
    before: { budgetCents: before?.budgetCents ?? null },
    after: { budgetCents: input.budgetCents },
  });
}
