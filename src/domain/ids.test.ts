import { describe, expectTypeOf, it } from "vitest";
import type { Brand, LeagueId } from "./ids";

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
