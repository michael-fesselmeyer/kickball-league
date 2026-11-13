import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENABLED,
  isPushTopic,
  PUSH_TOPICS,
  SETTINGS_TOPICS,
  TOPICS,
  wantsEmail,
  wantsPush,
} from "./topics";

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

describe("wantsPush", () => {
  it("is off until the person turns it on", () => {
    expect(wantsPush([], "rainout")).toBe(false);
    expect(wantsPush([{ topic: "rainout", enabled: true }], "rainout")).toBe(
      true,
    );
    expect(wantsPush([{ topic: "rainout", enabled: false }], "rainout")).toBe(
      false,
    );
  });

  it("never pushes a topic that is email only", () => {
    expect(
      wantsPush([{ topic: "announcement", enabled: true }], "announcement"),
    ).toBe(false);
    expect(isPushTopic("payment")).toBe(false);
  });

  it("offers push for rain-outs, sub requests and scores, all on the email page too", () => {
    expect(PUSH_TOPICS.map((t) => t.topic)).toEqual([
      "rainout",
      "sub_request",
      "score",
    ]);
    const emailTopics = SETTINGS_TOPICS.map((t) => t.topic);
    for (const { topic } of PUSH_TOPICS) expect(emailTopics).toContain(topic);
  });
});
