import { describe, expect, it } from "vitest";
import { appId, appScheme, DEFAULT_APP_ID, isAppId } from "./app-scheme";

describe("the apps' id and scheme", () => {
  it("uses the configured reverse domain", () => {
    expect(appId("org.example.kickball")).toBe("org.example.kickball");
    expect(appId(" Org.Example.Kickball ")).toBe("org.example.kickball");
    expect(appScheme("org.example.kickball")).toBe("org.example.kickball");
  });

  it("falls back to the placeholder when unset or malformed", () => {
    expect(appId(undefined)).toBe(DEFAULT_APP_ID);
    expect(appId("")).toBe(DEFAULT_APP_ID);
    expect(appId("kickball")).toBe(DEFAULT_APP_ID);
    expect(appId("https://evil.example")).toBe(DEFAULT_APP_ID);
    expect(appId("com.example.kick ball")).toBe(DEFAULT_APP_ID);
    expect(isAppId(DEFAULT_APP_ID)).toBe(true);
  });
});
