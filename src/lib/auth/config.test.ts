import { describe, expect, it } from "vitest";
import { isFreshSession, SESSION_FRESH_AGE_SECONDS } from "./config";

describe("isFreshSession", () => {
  const signedIn = new Date("2027-04-05T18:00:00Z");
  const after = (seconds: number) =>
    new Date(signedIn.getTime() + seconds * 1000);

  it("is fresh right after signing in, up to the fresh age", () => {
    expect(isFreshSession(signedIn, signedIn)).toBe(true);
    expect(isFreshSession(signedIn, after(SESSION_FRESH_AGE_SECONDS))).toBe(
      true,
    );
  });

  it("is stale after the fresh age", () => {
    expect(isFreshSession(signedIn, after(SESSION_FRESH_AGE_SECONDS + 1))).toBe(
      false,
    );
  });

  it("treats a sign-in time in the future as stale", () => {
    expect(isFreshSession(after(60), signedIn)).toBe(false);
  });
});
