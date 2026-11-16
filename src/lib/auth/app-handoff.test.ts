import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appCallbackUrl,
  challengeFor,
  HANDOFF_FRESH_SECONDS,
  handoffIdentifier,
  isBase64Url256,
  isFreshForHandoff,
  newHandoffCode,
  parseHandoffRecord,
  parseStartCookie,
  startCookieValue,
  verifierMatches,
} from "./app-handoff";

const verifier = randomBytes(32).toString("base64url");
const challenge = challengeFor(verifier);

describe("app handoff", () => {
  it("binds a code to the verifier the app kept, as PKCE does", () => {
    expect(isBase64Url256(verifier)).toBe(true);
    expect(isBase64Url256(challenge)).toBe(true);
    expect(verifierMatches(verifier, challenge)).toBe(true);
    const other = randomBytes(32).toString("base64url");
    expect(verifierMatches(other, challenge)).toBe(false);
    // The challenge itself is public, so it must not work as a verifier.
    expect(verifierMatches(challenge, challenge)).toBe(false);
    expect(verifierMatches("short", challenge)).toBe(false);
    expect(verifierMatches(undefined, challenge)).toBe(false);
  });

  it("is base64url SHA-256 with no padding (SHA-256 of \"abc\")", () => {
    expect(challengeFor("abc")).toBe(
      "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
    );
  });

  it("stores codes only by their hash", () => {
    const code = newHandoffCode();
    expect(isBase64Url256(code)).toBe(true);
    expect(handoffIdentifier(code)).toMatch(/^app-handoff:[0-9a-f]{64}$/);
    expect(handoffIdentifier(code)).not.toContain(code);
    expect(newHandoffCode()).not.toBe(code);
  });

  it("reads back only well-formed records", () => {
    const record = { type: "app-handoff", userId: "u1", challenge };
    expect(parseHandoffRecord(JSON.stringify(record))).toEqual(record);
    expect(
      parseHandoffRecord(JSON.stringify({ ...record, challenge: "x" })),
    ).toBeNull();
    expect(parseHandoffRecord(JSON.stringify({ ...record, type: "x" }))).toBe(
      null,
    );
    expect(parseHandoffRecord("{")).toBeNull();
  });

  it("returns to the app's own scheme with the code", () => {
    expect(appCallbackUrl("com.example.kickball", "abc_-1")).toBe(
      "com.example.kickball:/sign-in?code=abc_-1",
    );
    const url = new URL(appCallbackUrl("com.example.kickball", "abc"));
    expect(url.protocol).toBe("com.example.kickball:");
    expect(url.searchParams.get("code")).toBe("abc");
  });

  it("hands over only a sign-in made after the start and recently", () => {
    const start = Date.parse("2026-11-15T20:00:00Z");
    const at = (s: number) => new Date(start + s * 1000);
    expect(isFreshForHandoff(at(30), start, at(40))).toBe(true);
    // A session the browser already had before the app asked.
    expect(isFreshForHandoff(at(-60), start, at(40))).toBe(false);
    expect(
      isFreshForHandoff(at(30), start, at(31 + HANDOFF_FRESH_SECONDS)),
    ).toBe(false);
  });

  it("reads the start cookie back, and nothing else", () => {
    const value = startCookieValue(challenge, 1763236800000);
    expect(parseStartCookie(value)).toEqual({
      challenge,
      startedAt: 1763236800000,
    });
    expect(parseStartCookie(undefined)).toBeNull();
    expect(parseStartCookie(challenge)).toBeNull();
    expect(parseStartCookie(`${challenge}.soon`)).toBeNull();
    expect(parseStartCookie(`short.1`)).toBeNull();
  });
});
