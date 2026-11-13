import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import {
  canPostFor,
  checkEligibility,
  describeSpots,
  type Held,
  hasSpotFor,
  hold,
  isFreeAgent,
  type LineupGender,
  NOBODY,
  openSpots,
  type SubCandidate,
  type SubGame,
  suggestSubs,
} from "./eligibility";

const at = (hhmm: string) => new Date(`2026-09-14T${hhmm}:00Z`);

const game: SubGame = {
  kind: "regular",
  status: "scheduled",
  teamSeasonIds: ["aces", "bees"],
  startsAt: at("19:00"),
  endsAt: at("20:00"),
};

const player = (extra: Partial<SubCandidate> = {}): SubCandidate => ({
  registration: { kind: "team_member", status: "active" },
  teamSeasonId: "cats",
  lineupGender: "woman",
  commitments: [],
  ...extra,
});

describe("posting a sub request", () => {
  const before = at("12:00");

  it("is open until game time, which is when it closes", () => {
    expect(canPostFor(game, before)).toEqual(ok({ closesAt: at("19:00") }));
  });

  it("is blocked for playoff games, as the rulebook says", () => {
    expect(canPostFor({ ...game, kind: "playoff" }, before)).toEqual(
      err("playoff"),
    );
  });

  it("is blocked once the game has started or is over", () => {
    expect(canPostFor(game, at("19:00"))).toEqual(err("started"));
    expect(canPostFor({ ...game, status: "in_progress" }, before)).toEqual(
      err("started"),
    );
    for (const status of ["final", "forfeit", "cancelled"])
      expect(canPostFor({ ...game, status }, before)).toEqual(err("game_over"));
  });

  it("needs a time on the schedule", () => {
    expect(canPostFor({ ...game, startsAt: null }, before)).toEqual(
      err("not_placed"),
    );
    expect(canPostFor({ ...game, status: "postponed" }, before)).toEqual(
      err("not_placed"),
    );
  });
});

describe("who may sub", () => {
  it("takes a registered player from another team who is free then", () => {
    expect(checkEligibility(player(), game)).toEqual(ok(undefined));
  });

  it("takes a free agent, who comes first", () => {
    const fa = player({
      registration: { kind: "free_agent", status: "pending_payment" },
      teamSeasonId: null,
    });
    expect(checkEligibility(fa, game)).toEqual(ok(undefined));
    expect(isFreeAgent(fa)).toBe(true);
    expect(isFreeAgent(player())).toBe(false);
  });

  it("turns away a suspended player", () => {
    expect(checkEligibility(player({ suspended: true }), game)).toEqual(
      err("suspended"),
    );
    expect(checkEligibility(player({ suspended: false }), game)).toEqual(
      ok(undefined),
    );
  });

  it("needs a registration this season with the waiver signed", () => {
    expect(checkEligibility(player({ registration: null }), game)).toEqual(
      err("not_registered"),
    );
    for (const status of ["waitlisted", "cancelled", "refunded"] as const)
      expect(
        checkEligibility(
          player({ registration: { kind: "free_agent", status } }),
          game,
        ),
      ).toEqual(err("not_registered"));
    expect(
      checkEligibility(
        player({
          registration: { kind: "free_agent", status: "pending_waiver" },
        }),
        game,
      ),
    ).toEqual(err("waiver_unsigned"));
  });

  it("leaves out players on either team in the game", () => {
    for (const teamSeasonId of ["aces", "bees"])
      expect(checkEligibility(player({ teamSeasonId }), game)).toEqual(
        err("plays_in_game"),
      );
  });

  it("leaves out anyone playing or refereeing at an overlapping time", () => {
    const busy = (startsAt: string, endsAt: string) =>
      checkEligibility(
        player({
          commitments: [{ startsAt: at(startsAt), endsAt: at(endsAt) }],
        }),
        game,
      );
    expect(busy("19:00", "20:00")).toEqual(err("busy"));
    expect(busy("19:30", "20:30")).toEqual(err("busy"));
    expect(busy("18:30", "19:01")).toEqual(err("busy"));
    // Back to back is fine: the earlier game ends as this one starts.
    expect(busy("18:00", "19:00")).toEqual(ok(undefined));
    expect(busy("20:00", "21:00")).toEqual(ok(undefined));
  });
});

describe("spots", () => {
  const twoWithAWoman = { needed: 2, womenNeeded: 1, menNeeded: 0 };

  it("counts what is left after claims that hold a spot", () => {
    expect(openSpots(twoWithAWoman, NOBODY)).toEqual({
      left: 2,
      women: 1,
      men: 0,
    });
    expect(openSpots(twoWithAWoman, { women: 0, men: 1, unknown: 0 })).toEqual({
      left: 1,
      women: 1,
      men: 0,
    });
    expect(openSpots(twoWithAWoman, { women: 2, men: 0, unknown: 0 })).toEqual({
      left: 0,
      women: 0,
      men: 0,
    });
  });

  it("keeps a spot reserved for a woman away from a man", () => {
    const oneManIn: Held = { women: 0, men: 1, unknown: 0 };
    expect(hasSpotFor(twoWithAWoman, NOBODY, "man")).toBe(true);
    expect(hasSpotFor(twoWithAWoman, oneManIn, "man")).toBe(false);
    expect(hasSpotFor(twoWithAWoman, oneManIn, null)).toBe(false);
    expect(hasSpotFor(twoWithAWoman, oneManIn, "woman")).toBe(true);
  });

  it("lets a player with no lineup gender take an open spot only", () => {
    expect(hasSpotFor(twoWithAWoman, NOBODY, null)).toBe(true);
    expect(
      hasSpotFor({ needed: 1, womenNeeded: 1, menNeeded: 0 }, NOBODY, null),
    ).toBe(false);
  });

  it("has no spot once every one is held", () => {
    const full = hold(hold(NOBODY, "woman"), "man");
    for (const g of ["woman", "man", null] as const)
      expect(hasSpotFor(twoWithAWoman, full, g)).toBe(false);
  });

  const gender = fc.constantFrom<LineupGender | null>("woman", "man", null);
  const spots = fc
    .record({
      needed: fc.integer({ min: 1, max: 11 }),
      women: fc.integer({ min: 0, max: 11 }),
      men: fc.integer({ min: 0, max: 11 }),
    })
    .filter((s) => s.women + s.men <= s.needed)
    .map((s) => ({
      needed: s.needed,
      womenNeeded: s.women,
      menNeeded: s.men,
    }));

  it("never fills past what was asked, and a full request meets every reservation", () => {
    fc.assert(
      fc.property(spots, fc.array(gender, { maxLength: 30 }), (s, arrivals) => {
        let held = NOBODY;
        for (const g of arrivals)
          if (hasSpotFor(s, held, g)) held = hold(held, g);
        const taken = held.women + held.men + held.unknown;
        expect(taken).toBeLessThanOrEqual(s.needed);
        if (taken === s.needed) {
          expect(held.women).toBeGreaterThanOrEqual(s.womenNeeded);
          expect(held.men).toBeGreaterThanOrEqual(s.menNeeded);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("can always be filled by the right players, whoever claims first", () => {
    fc.assert(
      fc.property(spots, fc.array(gender, { maxLength: 30 }), (s, arrivals) => {
        let held = NOBODY;
        for (const g of arrivals)
          if (hasSpotFor(s, held, g)) held = hold(held, g);
        // Whatever came first, enough women then men can still finish it.
        for (const g of ["woman", "man"] as const)
          while (hasSpotFor(s, held, g)) held = hold(held, g);
        expect(held.women + held.men + held.unknown).toBe(s.needed);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("suggesting what to ask for", () => {
  it("asks for the women and men the fielding rule needs for a full 11", () => {
    expect(suggestSubs({ women: 3, men: 6 })).toEqual({
      needed: 2,
      womenNeeded: 2,
      menNeeded: 0,
    });
    expect(suggestSubs({ women: 5, men: 4 })).toEqual({
      needed: 2,
      womenNeeded: 0,
      menNeeded: 1,
    });
  });

  it("asks for nobody when the team can field 11", () => {
    expect(suggestSubs({ women: 5, men: 6 })).toEqual({
      needed: 0,
      womenNeeded: 0,
      menNeeded: 0,
    });
    expect(suggestSubs({ women: 8, men: 8 }).needed).toBe(0);
  });

  it("leaves the last spots open to anyone when both minimums are met", () => {
    expect(suggestSubs({ women: 5, men: 5 })).toEqual({
      needed: 1,
      womenNeeded: 0,
      menNeeded: 0,
    });
  });

  it("follows the season's own fielding numbers", () => {
    expect(
      suggestSubs(
        { women: 2, men: 2 },
        { maxFielders: 9, maxPerGender: 5, minimumToPlay: 7 },
      ),
    ).toEqual({ needed: 5, womenNeeded: 2, menNeeded: 2 });
  });
});

describe("describing a request", () => {
  it("says how many and any reserved spots", () => {
    expect(describeSpots({ needed: 1, womenNeeded: 0, menNeeded: 0 })).toBe(
      "1 sub",
    );
    expect(describeSpots({ needed: 3, womenNeeded: 2, menNeeded: 1 })).toBe(
      "3 subs, at least 2 women and 1 man",
    );
    expect(describeSpots({ needed: 2, womenNeeded: 0, menNeeded: 1 })).toBe(
      "2 subs, at least 1 man",
    );
  });
});
