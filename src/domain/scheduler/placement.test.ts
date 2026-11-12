import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRandom, type Random } from "../random";
import { measure } from "./measure";
import { constructPlacement, placementCost } from "./placement";
import { assignRoundsToDates, buildRounds, type Round } from "./rounds";
import { DEFAULT_WEIGHTS, type SchedulerInput } from "./types";
import { validate } from "./validate";
import { arbitraryLeague, league as leagueOf } from "./league.fixture";
import { slot, SUNDAYS, workedExample } from "./worked-example.fixture";

const inOrder: Random = { ...seededRandom(0), shuffle: (items) => [...items] };

/** Stages A, B and C1, as generate will run them. */
function place(
  input: SchedulerInput,
  random: Random = seededRandom(input.seed),
) {
  const rounds = buildRounds(
    input.teams.map((t) => t.id),
    input.rounds,
    random,
  );
  const { days, diagnostics } = assignRoundsToDates(rounds, input);
  const schedule = constructPlacement(rounds, days, input);
  return {
    ...schedule,
    diagnostics: [...diagnostics, ...schedule.diagnostics],
  };
}

const emptyCounts = () => ({
  time: new Map<string, number>(),
  field: new Map<string, number>(),
  lastTimeIndex: new Map<string, number>(),
});

describe("placementCost", () => {
  const s = slot("s", SUNDAYS[0], "F1", 1);
  const input = { constraints: [], weights: DEFAULT_WEIGHTS };

  it("is zero for a fresh season", () => {
    expect(placementCost(["A", "B"], s, emptyCounts(), input)).toBe(0);
  });

  it("charges for repeated times, fields and streaks", () => {
    const counts = emptyCounts();
    counts.time.set("A@1", 2);
    counts.field.set("B@F1", 1);
    counts.lastTimeIndex.set("A", 1);
    expect(placementCost(["A", "B"], s, counts, input)).toBe(
      2 * DEFAULT_WEIGHTS.timeBalance +
        DEFAULT_WEIGHTS.fieldBalance +
        DEFAULT_WEIGHTS.streaks,
    );
  });

  it("forbids unavailable slots and prices preferences", () => {
    const withConstraints = (constraints: SchedulerInput["constraints"]) =>
      placementCost(["A", "B"], s, emptyCounts(), { ...input, constraints });
    expect(
      withConstraints([{ teamId: "A", kind: "unavailable", date: SUNDAYS[0] }]),
    ).toBe(Infinity);
    expect(
      withConstraints([
        { teamId: "B", kind: "prefer", timeIndex: 0, weight: 3 },
      ]),
    ).toBe(3 * DEFAULT_WEIGHTS.preferences);
    expect(
      withConstraints([{ teamId: "B", kind: "avoid", timeIndex: 1 }]),
    ).toBe(DEFAULT_WEIGHTS.preferences);
    expect(
      withConstraints([
        { teamId: "B", kind: "avoid", timeIndex: 1, date: SUNDAYS[1] },
        { teamId: "C", kind: "unavailable" },
        { teamId: "A", kind: "avoid", date: SUNDAYS[0] },
      ]),
    ).toBe(0);
  });
});

describe("constructPlacement on the worked example", () => {
  const [input] = workedExample();

  it("is valid and already fairer than the naive placement", () => {
    const schedule = place(input, inOrder);
    expect(validate(input, schedule)).toEqual([]);
    expect(schedule.unplaced).toEqual([]);
    const m = measure(input, schedule);
    expect(m.timeSlotSpread.value).toBeLessThanOrEqual(2);
    expect(m.fieldSpread.value).toBeLessThanOrEqual(2);
    expect(m.reserveRemaining.value).toBe(14);
  });

  it("keeps locked games in their slots", () => {
    const locked = [{ gameKey: "r1:A:H", slotId: `${SUNDAYS[0]}/F2/2` }];
    const schedule = place({ ...input, locked }, inOrder);
    expect(schedule.games.find((g) => g.key === "r1:A:H")?.slotId).toBe(
      locked[0]?.slotId,
    );
    expect(validate({ ...input, locked }, schedule)).toEqual([]);
  });

  it("lists a game no slot can take, with a reason", () => {
    const constraints = [
      { teamId: "A", kind: "unavailable" as const, date: SUNDAYS[0] },
    ];
    const schedule = place({ ...input, constraints }, inOrder);
    expect(schedule.unplaced).toEqual(["r1:A:H"]);
    expect(schedule.diagnostics).toEqual([
      "Game r1:A:H could not be placed on 2027-04-04: no free slot suits both teams.",
    ]);
    expect(validate({ ...input, constraints }, schedule)).toEqual([]);
  });
});

const league = arbitraryLeague();

describe("constructPlacement properties", () => {
  it("P1 and P3: stages A to C1 never break a hard constraint", () => {
    fc.assert(
      fc.property(league, (input) => {
        expect(validate(input, place(input))).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it("P4: every game is placed once or listed as unplaced", () => {
    fc.assert(
      fc.property(league, (input) => {
        const schedule = place(input);
        for (const game of schedule.games)
          expect(game.slotId === null).toBe(
            schedule.unplaced.includes(game.key),
          );
        expect(new Set(schedule.unplaced).size).toBe(schedule.unplaced.length);
      }),
      { numRuns: 300 },
    );
  });

  it("P6: the same input gives the same schedule", () => {
    fc.assert(
      fc.property(league, (input) => {
        expect(place(input)).toEqual(place(input));
      }),
      { numRuns: 100 },
    );
  });
});

describe("constructPlacement edge cases", () => {
  const [input] = workedExample();

  it("ignores a lock for a game or slot that does not exist", () => {
    const locked = [
      { gameKey: "r9:X:Y", slotId: `${SUNDAYS[0]}/F1/0` },
      { gameKey: "r1:A:H", slotId: "nowhere" },
    ];
    const schedule = place({ ...input, locked }, inOrder);
    expect(schedule.unplaced).toEqual([]);
    expect(validate(input, schedule)).toEqual([]);
  });

  it("skips a round whose games are all locked in place", () => {
    const round1 = ["r1:A:H", "r1:B:G", "r1:C:F", "r1:D:E"];
    const locked = round1.map((gameKey, i) => ({
      gameKey,
      slotId: `${SUNDAYS[0]}/F${(i % 2) + 1}/${Math.floor(i / 2)}`,
    }));
    const schedule = place({ ...input, locked }, inOrder);
    for (const lock of locked)
      expect(schedule.games.find((g) => g.key === lock.gameKey)?.slotId).toBe(
        lock.slotId,
      );
    expect(validate({ ...input, locked }, schedule)).toEqual([]);
  });
});

describe("the exact day search", () => {
  // Two rounds of three games on two fields and three times: each round
  // needs two of the times, so the rounds must share one. T1 cannot play
  // the middle time. The greedy passes miss the one way it fits.
  const rounds: Round[] = [
    {
      round: 1,
      games: [
        ["T2", "T1"],
        ["T4", "T0"],
        ["T5", "T6"],
      ],
      bye: "T3",
    },
    {
      round: 2,
      games: [
        ["T3", "T1"],
        ["T2", "T6"],
        ["T4", "T5"],
      ],
      bye: "T0",
    },
  ];
  const day = (unavailable: number[]) => {
    const base = leagueOf({
      teams: 7,
      fields: 2,
      times: 3,
      dates: 1,
      gamesPerTeamPerDay: 2,
      reservePerDay: 0,
      rounds: 2,
      seed: 0,
    });
    return {
      ...base,
      constraints: unavailable.map((timeIndex) => ({
        teamId: "T1",
        kind: "unavailable" as const,
        date: "2027-06-01",
        timeIndex,
      })),
    };
  };
  const days = [{ date: "2027-06-01", rounds: [1, 2] }];

  it("finds a day where both rounds share a time", () => {
    const input = day([1]);
    const schedule = constructPlacement(rounds, days, input);
    expect(schedule.unplaced).toEqual([]);
    const slotOf = new Map(input.slots.map((x) => [x.id, x]));
    const seen = new Set<string>();
    for (const g of schedule.games) {
      const at = slotOf.get(g.slotId as string)?.timeIndex;
      for (const team of [g.teamA, g.teamB]) {
        expect(seen.has(`${team}@${at}`)).toBe(false);
        seen.add(`${team}@${at}`);
      }
      if (g.teamA === "T1" || g.teamB === "T1") expect(at).not.toBe(1);
    }
  });

  it("gives up within its budget and keeps the greedy result", () => {
    const schedule = constructPlacement(rounds, days, day([1]), {
      exactBudget: 1,
    });
    expect(schedule.unplaced.length).toBeGreaterThan(0);
    expect(schedule.diagnostics[0]).toContain("could not be placed");
  });

  it("leaves a day that cannot fit as it was, with a reason", () => {
    // T1 plays twice but can make only the first time.
    const schedule = constructPlacement(rounds, days, day([1, 2]));
    expect(schedule.unplaced.length).toBeGreaterThan(0);
    expect(schedule.diagnostics.length).toBe(schedule.unplaced.length);
  });
});
