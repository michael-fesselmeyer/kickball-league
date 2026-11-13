import { z } from "zod";
import { type AiModel, NO_USAGE, type TokenUsage } from "@/domain/ai/models";
import { err, ok, type Result } from "@/domain/result";

/**
 * The AI provider's Messages API, called from server code only, so the key
 * never reaches a browser. One request in, one JSON answer out, with the
 * response's token usage so every call can be costed. Tests pass their own
 * `AiCall` and never reach the network. See ADR 0017.
 */

export const AI_API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export type AiRequest = {
  model: AiModel;
  system: string;
  prompt: string;
  /** The answer's JSON schema; the API holds the model to it. */
  schema: Readonly<Record<string, unknown>>;
  maxTokens: number;
};

export type AiAnswer = {
  /** Billed whenever the API answered, even if the answer is unusable. */
  usage: TokenUsage;
  /** The parsed JSON answer, or null for a refusal, a cut-off or bad JSON. */
  json: unknown;
  stopReason: string;
};

/** `err` means the API never answered (network, timeout, 4xx/5xx): nothing billed. */
export type AiCall = (request: AiRequest) => Promise<Result<AiAnswer, string>>;

const responseSchema = z.object({
  content: z.array(
    z.looseObject({ type: z.string(), text: z.string().optional() }),
  ),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative().nullish(),
    cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
  }),
});

type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** The answer's text, parsed as JSON; null when it is not usable. */
function answerJson(
  content: z.infer<typeof responseSchema>["content"],
  stopReason: string | null,
): unknown {
  if (stopReason !== "end_turn") return null;
  const text = content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function aiCall(options: {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): AiCall {
  const doFetch: FetchLike = options.fetch ?? fetch;
  return async (request) => {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await doFetch(AI_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          output_config: {
            // A recap is short and needs little reasoning; low effort keeps
            // the cost down.
            effort: "low",
            format: { type: "json_schema", schema: request.schema },
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
    } catch (e) {
      return err(
        e instanceof Error && e.name === "TimeoutError"
          ? "The AI provider took too long"
          : "The AI provider could not be reached",
      );
    }
    if (!res.ok) return err(`The AI provider answered ${res.status}`);
    const parsed = responseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success)
      return err("The AI provider sent an answer we could not read");
    const { content, stop_reason, usage } = parsed.data;
    return ok({
      usage: {
        ...NO_USAGE,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
      json: answerJson(content, stop_reason),
      stopReason: stop_reason ?? "unknown",
    });
  };
}
