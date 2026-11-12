import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRandom, type Random } from "../random";
import { measure } from "./measure";
import { constructPlacement, placementCost } from "./placement";
import { assignRoundsToDates, buildRounds } from "./rounds";
import { DEFAULT_WEIGHTS, type SchedulerInput, type Slot } from "./types";
import { validate } from "./validate";
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

/** Random leagues: fields × times regular slots on each date. */
const league = fc
  .record({
    teams: fc.integer({ min: 4, max: 12 }),
    fields: fc.integer({ min: 1, max: 3 }),
    times: fc.integer({ min: 2, max: 4 }),
    dates: fc.integer({ min: 4, max: 10 }),
    gamesPerTeamPerDay: fc.constantFrom(1 as const, 2 as const),
    reservePerDay: fc.integer({ min: 0, max: 2 }),
    unavailable: fc.array(
      fc.record({
        team: fc.nat(),
        date: fc.option(fc.nat(), { nil: undefined }),
        time: fc.option(fc.nat(), { nil: undefined }),
      }),
      { maxLength: 4 },
    ),
    seed: fc.integer(),
  })
  .map((l): SchedulerInput => {
    const ids = Array.from({ length: l.teams }, (_, i) => `T${i}`);
    const dates = Array.from(
      { length: l.dates },
      (_, d) => `2027-06-${String(d + 1).padStart(2, "0")}`,
    );
    const slots: Slot[] = dates.flatMap((date) =>
      Array.from({ length: l.fields * l.times }, (_, k) =>
        slot(
          `${date}/F${k % l.fields}/${Math.floor(k / l.fields)}`,
          date,
          `F${k % l.fields}`,
          Math.floor(k / l.fields),
        ),
      ),
    );
    return {
      teams: ids.map((id) => ({ id })),
      slots,
      rounds: l.teams,
      gamesPerTeamPerDay: l.gamesPerTeamPerDay,
      reservePerDay: l.reservePerDay,
      constraints: l.unavailable.map((u) => ({
        teamId: ids[u.team % ids.length] as string,
        kind: "unavailable" as const,
        ...(u.date === undefined ? {} : { date: dates[u.date % dates.length] }),
        ...(u.time === undefined ? {} : { timeIndex: u.time % l.times }),
      })),
      locked: [],
      weights: DEFAULT_WEIGHTS,
      seed: l.seed,
    };
  });

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
