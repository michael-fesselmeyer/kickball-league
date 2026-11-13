import { describe, expect, it } from "vitest";
import { newState, statesMatch } from "./oauth-state";

describe("OAuth state", () => {
  it("is random and long enough to guess never", () => {
    const a = newState();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newState()).not.toBe(a);
  });

  it("matches only the same value, and never a missing one", () => {
    const s = newState();
    expect(statesMatch(s, s)).toBe(true);
    expect(statesMatch(s, newState())).toBe(false);
    expect(statesMatch(s, `${s}x`)).toBe(false);
    expect(statesMatch(undefined, s)).toBe(false);
    expect(statesMatch(s, null)).toBe(false);
  });
});
