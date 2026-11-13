/**
 * The models the AI features may use and their list prices, so every call's
 * cost can be worked out from its token usage. A model that is not listed
 * here cannot be configured (src/lib/env.ts), because its cost could not be
 * counted against the monthly budget. See ADR 0017.
 *
 * Pure: no clock, no network.
 */

/** US dollars per million tokens, as listed in November 2026. */
export type ModelPrice = { input: number; output: number };

export const AI_MODELS = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
} as const satisfies Record<string, ModelPrice>;

export type AiModel = keyof typeof AI_MODELS;
export const AI_MODEL_IDS = Object.keys(AI_MODELS) as [AiModel, ...AiModel[]];
export const DEFAULT_AI_MODEL: AiModel = "claude-opus-5-5";

export const isAiModel = (value: string): value is AiModel =>
  Object.hasOwn(AI_MODELS, value);

/** Token counts from one response. */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * What one response cost, in millionths of a dollar, rounded up. A price
 * per million tokens is the same number as millionths of a dollar per
 * token, so no scaling is needed.
 *
 * The features do not ask for prompt caching, so cache tokens should be
 * zero. If any appear they are counted on the safe side: cache reads at
 * the full input price, cache writes at the 1.25 times surcharge.
 */
export function costMicrodollars(model: AiModel, usage: TokenUsage): number {
  const price = AI_MODELS[model];
  const input =
    usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens * 1.25;
  return Math.ceil(input * price.input + usage.outputTokens * price.output);
}

/** The most a call can cost: its whole input plus every output token allowed. */
export function worstCaseMicrodollars(
  model: AiModel,
  maxInputTokens: number,
  maxOutputTokens: number,
): number {
  return costMicrodollars(model, {
    ...NO_USAGE,
    inputTokens: maxInputTokens,
    outputTokens: maxOutputTokens,
  });
}

/** "$0.03", "$4.97", "under $0.01". */
export function formatDollars(microdollars: number): string {
  if (microdollars > 0 && microdollars < 10_000) return "under $0.01";
  return `$${(Math.round(microdollars / 10_000) / 100).toFixed(2)}`;
}
