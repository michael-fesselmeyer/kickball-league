import { describe, expect, it } from "vitest";
import { DEFAULT_ENABLED, SETTINGS_TOPICS, TOPICS, wantsEmail } from "./topics";

describe("wantsEmail", () => {
  it("uses the default when the person has not chosen", () => {
    expect(wantsEmail([], "announcement")).toBe(true);
    expect(wantsEmail([], "marketing")).toBe(false);
  });

  it("follows the person's choice over the default", () => {
    expect(
      wantsEmail([{ topic: "announcement", enabled: false }], "announcement"),
    ).toBe(false);
    expect(
      wantsEmail([{ topic: "marketing", enabled: true }], "marketing"),
    ).toBe(true);
  });

  it("only reads the choice for that topic", () => {
    expect(wantsEmail([{ topic: "payment", enabled: false }], "rainout")).toBe(
      true,
    );
  });
});

describe("topics", () => {
  it("has a default for every topic, and settings only for real topics", () => {
    expect(Object.keys(DEFAULT_ENABLED).sort()).toEqual([...TOPICS].sort());
    for (const { topic } of SETTINGS_TOPICS) expect(TOPICS).toContain(topic);
  });
});
