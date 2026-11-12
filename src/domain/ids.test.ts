import { describe, expect, expectTypeOf, it } from "vitest";
import { type Brand, type LeagueId, parseId } from "./ids";

type TeamId = Brand<string, "TeamId">;

describe("branded IDs", () => {
  it("are still strings", () => {
    expectTypeOf<LeagueId>().toExtend<string>();
  });

  it("cannot be built from a plain string", () => {
    expectTypeOf<string>().not.toExtend<LeagueId>();
  });

  it("cannot be swapped for another kind of ID", () => {
    expectTypeOf<TeamId>().not.toExtend<LeagueId>();
    expectTypeOf<LeagueId>().not.toExtend<TeamId>();
  });
});

describe("parseId", () => {
  it("accepts a UUID and types it as the requested ID", () => {
    const id = parseId<LeagueId>("0b7a3c1e-4d2f-4a8b-9c6d-1e2f3a4b5c6d");
    expect(id).toBe("0b7a3c1e-4d2f-4a8b-9c6d-1e2f3a4b5c6d");
    expectTypeOf(id).toEqualTypeOf<LeagueId | null>();
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      "not-an-id",
      "0b7a3c1e-4d2f-4a8b-9c6d",
      42,
      null,
      undefined,
    ])
      expect(parseId<LeagueId>(bad)).toBeNull();
  });
});
