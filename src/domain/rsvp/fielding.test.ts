import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkFielding, fieldingRulesOf, RULEBOOK } from "./fielding";

describe("checkFielding", () => {
  it.each([
    // women, men, level, fielders
    [6, 5, "full", 11],
    [8, 9, "full", 11],
    [5, 5, "short", 10],
    [4, 5, "short", 9],
    [3, 4, "short", 7],
    [6, 1, "check", 7],
    [7, 0, "forfeit", 6],
    [3, 3, "forfeit", 6],
    [0, 0, "forfeit", 0],
  ] as const)(
    "%i women and %i men: %s with %i",
    (women, men, level, fielders) => {
      expect(checkFielding({ women, men })).toMatchObject({ level, fielders });
    },
  );

  it("names the lineup a short team can field", () => {
    expect(checkFielding({ women: 3, men: 6 }).message).toBe(
      "Short-handed: you can field 7 (4 and 3), a lineup the rulebook allows.",
    );
  });

  it("says when some players have no fielding group yet", () => {
    expect(checkFielding({ women: 6, men: 5, unknown: 2 }).message).toBe(
      "A full 11 on defense. 2 more have not set a fielding group in their profile.",
    );
    expect(checkFielding({ women: 6, men: 5, unknown: 1 }).message).toContain(
      "1 more has",
    );
  });

  it("follows the season's own numbers when they differ", () => {
    expect(
      checkFielding(
        { women: 5, men: 5 },
        {
          maxFielders: 10,
          maxPerGender: 5,
          minimumToPlay: 6,
          minimumOwnPlayers: 5,
        },
      ),
    ).toMatchObject({ level: "full", fielders: 10 });
  });

  it("says how many pickups would save a short team", () => {
    expect(checkFielding({ women: 7, men: 0 }).message).toBe(
      "Only 6 can take the field within the rule (at most 6 of any gender). Fewer than 7 is a forfeit. Pick up 1 registered player to play, or it's a forfeit.",
    );
    expect(checkFielding({ women: 3, men: 3, unknown: 1 }).message).toContain(
      "Pick up 1 registered player to play",
    );
  });

  it("offers no pickups in a playoff game", () => {
    const check = checkFielding({ women: 3, men: 3 }, undefined, {
      pickupsAllowed: false,
    });
    expect(check.level).toBe("forfeit");
    expect(check.message).toContain("Playoff games can't use pickups.");
    expect(check.message).not.toContain("Pick up");
  });

  it("is a forfeit below the team's own-player minimum, whatever pickups come", () => {
    const check = checkFielding({ women: 3, men: 2 });
    expect(check.level).toBe("forfeit");
    expect(check.message).toBe(
      "Only 5 of the team's own players are in. A game counts only with at least 6 of a team's own players, and pickups don't count toward that, so this is a forfeit. The teams can still play a pickup game.",
    );
    // Players with no fielding group still count as the team's own.
    expect(
      checkFielding({ women: 3, men: 2, unknown: 1 }).message,
    ).not.toContain("own players are in");
  });

  it("follows the season's own-player minimum", () => {
    const rules = {
      maxFielders: 11,
      maxPerGender: 6,
      minimumToPlay: 7,
      minimumOwnPlayers: 4,
    };
    expect(checkFielding({ women: 3, men: 2 }, rules).message).toContain(
      "Pick up 2 registered players",
    );
  });

  it("fills in the rulebook's numbers a season leaves out", () => {
    expect(fieldingRulesOf({ maxFielders: 10 })).toEqual({
      maxFielders: 10,
      maxPerGender: 6,
      minimumToPlay: 7,
      minimumOwnPlayers: 6,
    });
    expect(fieldingRulesOf(null)).toEqual(RULEBOOK);
  });

  it("never fields more than the limits allow, and more players never hurt", () => {
    fc.assert(
      fc.property(fc.nat(20), fc.nat(20), (women, men) => {
        const a = checkFielding({ women, men });
        expect(a.fielders).toBeLessThanOrEqual(11);
        expect(a.fielders).toBeLessThanOrEqual(
          Math.min(women, 6) + Math.min(men, 6),
        );
        const rank = { forfeit: 0, check: 1, short: 2, full: 3 };
        const b = checkFielding({ women: women + 1, men });
        expect(b.fielders).toBeGreaterThanOrEqual(a.fielders);
        if (a.level !== "check")
          expect(rank[b.level]).toBeGreaterThanOrEqual(rank[a.level]);
      }),
    );
  });
});
