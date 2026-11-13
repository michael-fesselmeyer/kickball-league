import { describe, expect, it } from "vitest";
import { instagramSettings } from "./instagram-settings";

// Valid in form only: digits for the ID, 32 letters for the secret.
const APP = {
  INSTAGRAM_APP_ID: "1".repeat(16),
  INSTAGRAM_APP_SECRET: "a".repeat(32),
};

describe("instagramSettings", () => {
  it("is off, with no complaint, when neither is set", () => {
    expect(instagramSettings({})).toEqual({ on: false, reason: null });
    expect(
      instagramSettings({ INSTAGRAM_APP_ID: "", INSTAGRAM_APP_SECRET: " " }),
    ).toEqual({ on: false, reason: null });
  });

  it("is on with both", () => {
    expect(instagramSettings(APP)).toEqual({
      on: true,
      app: {
        appId: APP.INSTAGRAM_APP_ID,
        appSecret: APP.INSTAGRAM_APP_SECRET,
      },
    });
  });

  it("stays off with half a pair, naming what is missing", () => {
    const half = instagramSettings({ INSTAGRAM_APP_ID: APP.INSTAGRAM_APP_ID });
    expect(half).toEqual({
      on: false,
      reason: "Set both INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET, or neither.",
    });
  });

  it.each([
    ["INSTAGRAM_APP_ID", "abc"],
    ["INSTAGRAM_APP_SECRET", "short"],
    ["INSTAGRAM_APP_SECRET", "has spaces and symbols!!!!!!!!!!"],
  ])("stays off with a malformed %s, never echoing it", (name, value) => {
    const result = instagramSettings({ ...APP, [name]: value });
    expect(result.on).toBe(false);
    if (result.on) return;
    expect(result.reason).toContain(name);
    expect(result.reason).not.toContain(value);
  });
});
