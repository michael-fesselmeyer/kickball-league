import { describe, expect, it } from "vitest";
import { readable } from "./labels";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const teams = new Map([
  [A, "Base Invaders"],
  [B, "Sun Kickers"],
]);

describe("readable", () => {
  it("names the teams and writes the day the way the screen does", () => {
    expect(
      readable(
        `Game r3:${A}:${B} could not be placed on 2027-04-19: no free slot suits both teams.`,
        teams,
      ),
    ).toBe(
      "Game Base Invaders vs Sun Kickers (round 3) could not be placed on Mon, Apr 19: no free slot suits both teams.",
    );
  });
});
