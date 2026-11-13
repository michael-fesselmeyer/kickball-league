import { describe, expect, it, vi } from "vitest";
import { AI_API_URL, aiCall, type AiRequest } from "./ai";

/** A made-up key in the provider's format; never a real one. */
const KEY = "sk-ant-test-0000";

const REQUEST: AiRequest = {
  model: "claude-haiku-5-5",
  system: "Write a recap.",
  prompt: "<facts>{}</facts>",
  schema: { type: "object" },
  maxTokens: 4_000,
};

const reply = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

const message = (overrides: Record<string, unknown> = {}) => ({
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text: '{"subject":"Hi","body":"Hello"}' },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 3000, output_tokens: 800 },
  ...overrides,
});

describe("aiCall", () => {
  it("posts one message with the key, the version and the answer's schema", async () => {
    const fetch = reply(message());
    await aiCall({ apiKey: KEY, fetch })(REQUEST);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AI_API_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 4_000,
      system: "Write a recap.",
      messages: [{ role: "user", content: "<facts>{}</facts>" }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: { type: "object" } },
      },
    });
  });

  it("returns the parsed answer and the token usage", async () => {
    const result = await aiCall({
      apiKey: KEY,
      fetch: reply(
        message({
          usage: {
            input_tokens: 3000,
            output_tokens: 800,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: null,
          },
        }),
      ),
    })(REQUEST);
    expect(result).toEqual({
      ok: true,
      value: {
        usage: {
          inputTokens: 3000,
          outputTokens: 800,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
        },
        json: { subject: "Hi", body: "Hello" },
        stopReason: "end_turn",
      },
    });
  });

  it("keeps the usage but no answer for a refusal, a cut-off or bad JSON", async () => {
    for (const body of [
      message({ stop_reason: "refusal" }),
      message({ stop_reason: "max_tokens" }),
      message({ content: [{ type: "text", text: "not json" }] }),
    ]) {
      const result = await aiCall({ apiKey: KEY, fetch: reply(body) })(REQUEST);
      expect(result.ok && result.value.json).toBeNull();
      expect(result.ok && result.value.usage.outputTokens).toBe(800);
    }
  });

  it("is an error when the API never answers", async () => {
    expect(
      await aiCall({ apiKey: KEY, fetch: reply({}, 529) })(REQUEST),
    ).toEqual({ ok: false, error: "The AI provider answered 529" });
    expect(
      await aiCall({ apiKey: KEY, fetch: reply({ unexpected: true }) })(
        REQUEST,
      ),
    ).toEqual({
      ok: false,
      error: "The AI provider sent an answer we could not read",
    });

    const offline = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await aiCall({ apiKey: KEY, fetch: offline })(REQUEST)).toEqual({
      ok: false,
      error: "The AI provider could not be reached",
    });

    const timeout = Object.assign(new Error("slow"), { name: "TimeoutError" });
    const slow = vi.fn().mockRejectedValue(timeout);
    expect(await aiCall({ apiKey: KEY, fetch: slow })(REQUEST)).toEqual({
      ok: false,
      error: "The AI provider took too long",
    });
  });
});
