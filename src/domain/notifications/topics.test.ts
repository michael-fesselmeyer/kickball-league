import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENABLED,
  isPushTopic,
  NEWS_TOPICS,
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
    // Weather watches are opt-in (issue #383).
    expect(wantsEmail([], "game_day_watch")).toBe(false);
    expect(
      wantsEmail(
        [{ topic: "game_day_watch", enabled: true }],
        "game_day_watch",
      ),
    ).toBe(true);
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

  it("offers push for rain-outs, weather watches, sub requests and scores, all on the email page too", () => {
    expect(PUSH_TOPICS.map((t) => t.topic)).toEqual([
      "rainout",
      "game_day_watch",
      "sub_request",
      "score",
    ]);
    const emailTopics = SETTINGS_TOPICS.map((t) => t.topic);
    for (const { topic } of PUSH_TOPICS) expect(emailTopics).toContain(topic);
  });
});

describe("rules and schedule (#521)", () => {
  it("is on by default and offered in the settings", () => {
    expect(TOPICS).toContain("rules");
    expect(DEFAULT_ENABLED.rules).toBe(true);
    expect(wantsEmail([], "rules")).toBe(true);
    expect(SETTINGS_TOPICS.map((t) => t.topic)).toContain("rules");
  });

  it("keeps a choice to turn it off", () => {
    expect(wantsEmail([{ topic: "rules", enabled: false }], "rules")).toBe(
      false,
    );
  });

  it("tells news apart from game messages", () => {
    expect(NEWS_TOPICS.has("announcement")).toBe(true);
    for (const topic of ["rules", "payment", "rainout", "sub_request"] as const)
      expect(NEWS_TOPICS.has(topic)).toBe(false);
  });
});
