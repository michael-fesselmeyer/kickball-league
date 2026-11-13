import { describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { feedPath, feedToken, feedTokenUser, isFeedToken } from "./event-feed";

// A made-up value for the tests, not a real secret.
const SECRET = "test only, long enough to stand in for the server's own";
const PAT = "d3e30000-0000-4000-8000-000000000001" as UserId;
const CASEY = "d3e30000-0000-4000-8000-000000000002" as UserId;

describe("event feed tokens", () => {
  it("names the person and checks against the current version", () => {
    const token = feedToken(SECRET, PAT, 1);
    expect(feedTokenUser(token)).toBe(PAT);
    expect(isFeedToken(SECRET, token, PAT, 1)).toBe(true);
    expect(token).toMatch(/^[0-9a-f]{32}[\w-]{32}$/);
  });

  it("stops working after a reset, for another person, or with another secret", () => {
    const token = feedToken(SECRET, PAT, 1);
    expect(isFeedToken(SECRET, token, PAT, 2)).toBe(false);
    expect(isFeedToken(SECRET, token, CASEY, 1)).toBe(false);
    expect(isFeedToken(`${SECRET}!`, token, PAT, 1)).toBe(false);
    expect(isFeedToken(SECRET, token.slice(0, -1), PAT, 1)).toBe(false);
  });

  it("refuses tokens that don't start with an id", () => {
    expect(feedTokenUser("not-a-token")).toBeNull();
    expect(feedTokenUser("")).toBeNull();
  });

  it("builds the feed's path", () => {
    expect(feedPath("abc")).toBe("/events/personal/abc/calendar.ics");
  });
});
