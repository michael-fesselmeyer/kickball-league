import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./token-crypto";

// A stand-in for the auth secret: long enough, plainly not a real one.
const SECRET = "x".repeat(40);
const ROW = "social_account:7b0f2a52-1d5e-4b8e-9a8a-0b6f6a1c2d3e";

describe("token encryption", () => {
  it("round-trips and never stores the token in the clear", () => {
    const stored = encryptToken("IGAAfixture-token", SECRET, ROW);
    expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(stored).not.toContain("fixture-token");
    expect(decryptToken(stored, SECRET, ROW)).toBe("IGAAfixture-token");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptToken("same", SECRET, ROW)).not.toBe(
      encryptToken("same", SECRET, ROW),
    );
  });

  it("refuses another key, another row or an altered value", () => {
    const stored = encryptToken("IGAAfixture-token", SECRET, ROW);
    expect(decryptToken(stored, `${SECRET}x`, ROW)).toBeNull();
    expect(decryptToken(stored, SECRET, `${ROW}x`)).toBeNull();
    const [v, iv, tag, body] = stored.split(".");
    const flipped = `${body![0] === "A" ? "B" : "A"}${body!.slice(1)}`;
    expect(
      decryptToken([v, iv, tag, flipped].join("."), SECRET, ROW),
    ).toBeNull();
    expect(decryptToken("v2.a.b.c", SECRET, ROW)).toBeNull();
    expect(decryptToken("garbage", SECRET, ROW)).toBeNull();
  });
});
