import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/teams?season=spring#roster", "/app/teams?season=spring#roster"],
    ["/", "/"],
  ])("keeps the same-site path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://evil.example/app"],
    ["a protocol-relative URL", "//evil.example/app"],
    ["a backslash trick", "/\\evil.example"],
    ["a tab inside the slashes", "/\t/evil.example"],
    ["a newline inside the slashes", "/\n/evil.example"],
    ["a path that normalizes to // (found by fast-check)", "/.//evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "app"],
    ["an empty string", ""],
    ["a missing value", undefined],
    ["a non-string", 42],
  ])("falls back to the default for %s", (_label, raw) => {
    expect(safeNextPath(raw)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("never returns anything a browser would treat as another site", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.webUrl(), fc.webPath()), (raw) => {
        const result = safeNextPath(raw);
        expect(result.startsWith("/")).toBe(true);
        expect(new URL(result, "https://league.example").origin).toBe(
          "https://league.example",
        );
      }),
      { numRuns: 2000 },
    );
  });

  it("is stable: cleaning an already-clean path changes nothing", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = safeNextPath(raw);
        expect(safeNextPath(once)).toBe(once);
      }),
      { numRuns: 2000 },
    );
  });
});
