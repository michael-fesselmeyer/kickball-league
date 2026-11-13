import { db } from "@/db/client";
import { aiBudget, monthSpend } from "@/db/queries/ai";
import { type AiAvailability, aiAvailability } from "@/domain/ai/budget";
import { type AiModel, DEFAULT_AI_MODEL } from "@/domain/ai/models";
import { env } from "@/env";
import { featureEnabled } from "@/lib/platform/site";
import { aiCall, type AiCall } from "@/services/ai";
import { recapWorstCase } from "./recap";

/** The AI provider's key and model, or null when no key is configured. */
export function aiConfig(): { call: AiCall; model: AiModel } | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return {
    call: aiCall({ apiKey: env.ANTHROPIC_API_KEY }),
    model: env.AI_MODEL ?? DEFAULT_AI_MODEL,
  };
}

/**
 * Whether admins can ask for an AI recap now: a key is set, the operator
 * left the feature on, and the month's budget has room for one more.
 */
export async function recapAvailability(now: Date): Promise<AiAvailability> {
  const config = aiConfig();
  const on = config !== null && (await featureEnabled("ai"));
  const budget = on ? await aiBudget(db) : null;
  if (!config || !on || !budget) return { kind: "hidden" };
  return aiAvailability({
    configured: true,
    featureOn: true,
    budgetCents: budget.budgetCents,
    spentMicrodollars: await monthSpend(db, budget.leagueId, now),
    worstCaseMicrodollars: recapWorstCase(config.model),
    now,
  });
}
