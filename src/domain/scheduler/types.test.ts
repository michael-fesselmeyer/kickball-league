import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, gameKey } from "./types";

describe("gameKey", () => {
  it("is the same whichever team is listed first", () => {
    expect(gameKey(3, "sun-kickers", "big-kicks")).toBe(
      "r3:big-kicks:sun-kickers",
    );
    expect(gameKey(3, "big-kicks", "sun-kickers")).toBe(
      "r3:big-kicks:sun-kickers",
    );
  });

  it("differs by round, so a rematch has its own key", () => {
    expect(gameKey(1, "a", "b")).not.toBe(gameKey(8, "a", "b"));
  });
});

describe("DEFAULT_WEIGHTS", () => {
  it("matches the defaults in scheduling-algorithm.md, section 2", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      timeBalance: 100,
      fieldBalance: 100,
      streaks: 20,
      doubleheaderWait: 30,
      idleFields: 5,
      preferences: 10,
      rematchSpacing: 10,
      backToBackByes: 50,
      fineBalance: 1,
    });
  });
});
