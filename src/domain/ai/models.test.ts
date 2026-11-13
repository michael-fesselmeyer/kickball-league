import { describe, expect, it } from "vitest";
import {
  AI_MODEL_IDS,
  aiSettings,
  costMicrodollars,
  DEFAULT_AI_MODEL,
  formatDollars,
  isAiModel,
  NO_USAGE,
  worstCaseMicrodollars,
} from "./models";

describe("AI models", () => {
  it("lists the default and only models with a price", () => {
    expect(AI_MODEL_IDS).toContain(DEFAULT_AI_MODEL);
    expect(isAiModel("claude-haiku-5-5")).toBe(true);
    expect(isAiModel("some-other-model")).toBe(false);
    expect(isAiModel("toString")).toBe(false);
  });
});

describe("aiSettings", () => {
  const KEY = "sk-ant-test-0000";

  it("is off without a key, or with a key in the wrong format", () => {
    expect(aiSettings({})).toBeNull();
    expect(aiSettings({ ANTHROPIC_API_KEY: "" })).toBeNull();
    expect(aiSettings({ ANTHROPIC_API_KEY: "sk_test_abc" })).toBeNull();
    expect(aiSettings({ ANTHROPIC_API_KEY: "sk-ant-has space" })).toBeNull();
  });

  it("uses the default model unless a priced one is chosen", () => {
    expect(aiSettings({ ANTHROPIC_API_KEY: ` ${KEY} ` })).toEqual({
      apiKey: KEY,
      model: "claude-opus-5-5",
    });
    expect(
      aiSettings({ ANTHROPIC_API_KEY: KEY, AI_MODEL: "claude-haiku-5-5" }),
    ).toEqual({ apiKey: KEY, model: "claude-haiku-5-5" });
    expect(aiSettings({ ANTHROPIC_API_KEY: KEY, AI_MODEL: "" })?.model).toBe(
      "claude-opus-5-5",
    );
  });

  it("stays off for a model with no known price", () => {
    expect(
      aiSettings({ ANTHROPIC_API_KEY: KEY, AI_MODEL: "unpriced-model" }),
    ).toBeNull();
  });
});

describe("costMicrodollars", () => {
  it("prices a typical recap", () => {
    // 3,000 in at $4/M and 800 out at $20/M: 1.2 cents + 1.6 cents.
    const usage = { ...NO_USAGE, inputTokens: 3_000, outputTokens: 800 };
    expect(costMicrodollars("claude-opus-5-5", usage)).toBe(28_000);
    expect(costMicrodollars("claude-haiku-5-5", usage)).toBe(700);
  });

  it("rounds up and counts cache tokens on the safe side", () => {
    expect(
      costMicrodollars("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 1 }),
    ).toBe(1);
    expect(
      costMicrodollars("claude-opus-5-5", {
        ...NO_USAGE,
        cacheReadTokens: 100,
        cacheWriteTokens: 100,
      }),
    ).toBe(900);
  });

  it("prices the worst case from the limits", () => {
    expect(worstCaseMicrodollars("claude-opus-5-5", 8_000, 4_000)).toBe(
      112_000,
    );
  });
});

describe("formatDollars", () => {
  it("shows dollars and cents", () => {
    expect(formatDollars(0)).toBe("$0.00");
    expect(formatDollars(28_000)).toBe("$0.03");
    expect(formatDollars(5_000_000)).toBe("$5.00");
    expect(formatDollars(700)).toBe("under $0.01");
  });
});
