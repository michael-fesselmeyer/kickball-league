import { describe, expect, it } from "vitest";
import {
  generateSignInCode,
  hashSignInCode,
  normalizeSignInCode,
  parseSignInCodeRecord,
  signInCodeIdentifier,
  signInCodeMatches,
} from "./sign-in-code";

const SECRET = "x".repeat(32);

describe("sign-in codes", () => {
  it("are six digits, leading zeros kept", () => {
    for (let i = 0; i < 200; i++)
      expect(generateSignInCode()).toMatch(/^\d{6}$/);
  });

  it("accept a code typed or pasted with a space or dash", () => {
    expect(normalizeSignInCode("042137")).toBe("042137");
    expect(normalizeSignInCode(" 042 137 ")).toBe("042137");
    expect(normalizeSignInCode("042-137")).toBe("042137");
    expect(normalizeSignInCode("42137")).toBeNull();
    expect(normalizeSignInCode("0421370")).toBeNull();
    expect(normalizeSignInCode("04213a")).toBeNull();
    expect(normalizeSignInCode(42137)).toBeNull();
  });

  it("keep one pending code per address, whatever its case, without storing it", () => {
    const id = signInCodeIdentifier("Player@Example.test ");
    expect(id).toBe(signInCodeIdentifier("player@example.test"));
    expect(id).toMatch(/^sign-in-code:[0-9a-f]{64}$/);
    expect(id).not.toContain("example");
  });

  it("match only the code, the address and the secret they were made with", () => {
    const hash = hashSignInCode(SECRET, "player@example.test", "042137");
    expect(hash).not.toContain("042137");
    expect(
      signInCodeMatches(SECRET, "PLAYER@example.test", "042137", hash),
    ).toBe(true);
    expect(
      signInCodeMatches(SECRET, "player@example.test", "042138", hash),
    ).toBe(false);
    expect(signInCodeMatches(SECRET, "other@example.test", "042137", hash)).toBe(
      false,
    );
    expect(
      signInCodeMatches("y".repeat(32), "player@example.test", "042137", hash),
    ).toBe(false);
    expect(
      signInCodeMatches(SECRET, "player@example.test", "042137", "abcd"),
    ).toBe(false);
  });

  it("read back only well-formed records", () => {
    const record = {
      type: "sign-in-code",
      email: "player@example.test",
      codeHash: "ab",
      link: "token-hash",
      callbackURL: "/app",
    };
    expect(parseSignInCodeRecord(JSON.stringify(record))).toEqual(record);
    expect(
      parseSignInCodeRecord(JSON.stringify({ ...record, type: "magic-link" })),
    ).toBeNull();
    expect(
      parseSignInCodeRecord(JSON.stringify({ ...record, link: 1 })),
    ).toBeNull();
    expect(parseSignInCodeRecord("not json")).toBeNull();
    expect(parseSignInCodeRecord("null")).toBeNull();
  });
});
