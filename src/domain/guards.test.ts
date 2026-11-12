import { describe, expect, expectTypeOf, it } from "vitest";
import { isOneOf, recordOf } from "./guards";

describe("isOneOf", () => {
  const SIZES = ["s", "m", "l"] as const;

  it("narrows a value to the listed options", () => {
    const value: unknown = "m";
    if (isOneOf(SIZES, value))
      expectTypeOf(value).toEqualTypeOf<"s" | "m" | "l">();
    expect(isOneOf(SIZES, value)).toBe(true);
  });

  it("refuses other strings and non-strings", () => {
    for (const bad of ["xl", "", 1, null, undefined])
      expect(isOneOf(SIZES, bad)).toBe(false);
  });
});

describe("recordOf", () => {
  it("builds a record with exactly the given keys", () => {
    const record = recordOf(["a", "b"] as const, (key) => key.toUpperCase());
    expect(record).toEqual({ a: "A", b: "B" });
    expectTypeOf(record).toEqualTypeOf<Record<"a" | "b", string>>();
  });
});
