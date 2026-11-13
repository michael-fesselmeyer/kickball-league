import { reserveAiCall, saveRecapDraft, settleAiCall } from "@/db/queries/ai";
import type { Db } from "@/db/queries/schedule";
import {
  type AiModel,
  costMicrodollars,
  NO_USAGE,
  worstCaseMicrodollars,
} from "@/domain/ai/models";
import {
  checkRecapAnswer,
  RECAP_OUTPUT_SCHEMA,
  RECAP_SYSTEM_PROMPT,
  type RecapFacts,
  recapPrompt,
  type RecapRejection,
} from "@/domain/ai/recap";
import type { LeagueId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { AiCall } from "@/services/ai";

/**
 * Writes one AI recap draft: reserve the call's worst-case cost against the
 * month's budget, call the model, record what it really cost, check the
 * answer, and keep it for the admin to edit. Nothing is sent from here.
 * See ADR 0013.
 */

/** Room for the model's answer, its reasoning included. */
export const RECAP_MAX_OUTPUT_TOKENS = 4_000;
/**
 * The most input a recap may send. A league of 24 teams sends about 3,000
 * tokens; anything near this is refused rather than risk the budget.
 */
export const RECAP_MAX_INPUT_TOKENS = 8_000;

/**
 * A safe upper bound on the tokens in some text. English runs about four
 * characters a token; two leaves room for names in other scripts and emoji.
 */
export const tokenBound = (text: string) => Math.ceil(text.length / 2);

/** The most one recap call can cost, for the availability check. */
export const recapWorstCase = (model: AiModel) =>
  worstCaseMicrodollars(model, RECAP_MAX_INPUT_TOKENS, RECAP_MAX_OUTPUT_TOKENS);

export type RecapFailure =
  "over_budget" | "too_big" | "no_answer" | RecapRejection;

/** What the reservation needs from the transaction-capable client. */
type Transactor = {
  transaction<T>(body: (tx: Db) => Promise<T>): Promise<T>;
};

export async function writeRecapDraft(
  deps: { db: Db; txDb: Transactor; call: AiCall; model: AiModel; now: Date },
  input: {
    leagueId: LeagueId;
    seasonId: SeasonId;
    day: string;
    facts: RecapFacts;
    actorId: UserId;
  },
): Promise<Result<{ subject: string; body: string }, RecapFailure>> {
  const prompt = recapPrompt(input.facts);
  if (tokenBound(RECAP_SYSTEM_PROMPT + prompt) > RECAP_MAX_INPUT_TOKENS)
    return err("too_big");

  const reserved = await deps.txDb.transaction((tx) =>
    reserveAiCall(tx, {
      leagueId: input.leagueId,
      feature: "recap",
      model: deps.model,
      worstCaseMicrodollars: recapWorstCase(deps.model),
      actorId: input.actorId,
      now: deps.now,
    }),
  );
  if (!reserved.ok) return reserved;
  const usageId = reserved.value;

  const answer = await deps.call({
    model: deps.model,
    system: RECAP_SYSTEM_PROMPT,
    prompt,
    schema: RECAP_OUTPUT_SCHEMA,
    maxTokens: RECAP_MAX_OUTPUT_TOKENS,
  });
  if (!answer.ok) {
    await settleAiCall(deps.db, usageId, {
      usage: NO_USAGE,
      costMicrodollars: 0,
      outcome: "failed",
    });
    return err("no_answer");
  }

  const cost = costMicrodollars(deps.model, answer.value.usage);
  const checked =
    answer.value.json === null
      ? err("no_answer" as const)
      : checkRecapAnswer(answer.value.json, input.facts);
  if (!checked.ok) {
    await settleAiCall(deps.db, usageId, {
      usage: answer.value.usage,
      costMicrodollars: cost,
      outcome: "rejected",
    });
    return checked;
  }

  await saveRecapDraft(deps.db, {
    seasonId: input.seasonId,
    day: input.day,
    ...checked.value,
    model: deps.model,
    createdBy: input.actorId,
    now: deps.now,
  });
  await settleAiCall(deps.db, usageId, {
    usage: answer.value.usage,
    costMicrodollars: cost,
    outcome: "accepted",
  });
  return ok(checked.value);
}
