import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generate } from "./generate";
import { arbitraryLeague, league } from "./league.fixture";
import { measure } from "./measure";
import { validate } from "./validate";
import { workedExample } from "./worked-example.fixture";

describe("generate", () => {
  it("reaches the best possible spreads on the worked example", () => {
    const [input] = workedExample();
    const schedule = generate(input);
    expect(schedule.diagnostics).toEqual([]);
    expect(schedule.unplaced).toEqual([]);
    const m = measure(input, schedule);
    expect(m.timeSlotSpread).toMatchObject({ value: 1, bestPossible: 1 });
    expect(m.fieldSpread).toMatchObject({ value: 1, bestPossible: 1 });
    expect(m.longestStreak.value).toBeLessThanOrEqual(2);
    expect(m.reserveRemaining.byDate.every((d) => d.empty === 2)).toBe(true);
  });

  it("lists byes for an odd team count", () => {
    const input = league({
      teams: 9,
      fields: 2,
      times: 3,
      dates: 9,
      gamesPerTeamPerDay: 1,
      reservePerDay: 1,
    });
    const schedule = generate(input);
    expect(validate(input, schedule)).toEqual([]);
    expect(schedule.byes).toHaveLength(9);
    expect(new Set(schedule.byes.map((b) => b.teamId)).size).toBe(9);
  });

  it("keeps divisions apart and shares the slots between them", () => {
    const input = league({
      teams: 8,
      fields: 2,
      times: 3,
      dates: 6,
      gamesPerTeamPerDay: 1,
      reservePerDay: 2,
      rounds: 3,
      divisions: 2,
    });
    const schedule = generate(input);
    const division = new Map(input.teams.map((t) => [t.id, t.divisionId]));
    expect(validate(input, schedule)).toEqual([]);
    expect(
      schedule.games.every(
        (g) => division.get(g.teamA) === division.get(g.teamB),
      ),
    ).toBe(true);
    // Both divisions play round 1 on the first date.
    expect(schedule.games.filter((g) => g.round === 1)).toHaveLength(4);
  });

  it("explains a season too long for its dates", () => {
    const input = league({
      teams: 8,
      fields: 2,
      times: 3,
      dates: 5,
      gamesPerTeamPerDay: 1,
      reservePerDay: 2,
      rounds: 7,
    });
    const schedule = generate(input);
    expect(schedule.diagnostics).toEqual([
      "Not enough slots: 2 rounds could not be given a date. Add dates or slots, or lower the makeup reserve.",
    ]);
    expect(schedule.unplaced).toHaveLength(8);
    expect(validate(input, schedule)).toEqual([]);
  });

  it("reports a hard violation it cannot avoid instead of hiding it", () => {
    // A two-team division playing doubleheaders must meet twice in a day.
    const input = league({
      teams: 4,
      fields: 2,
      times: 2,
      dates: 2,
      gamesPerTeamPerDay: 2,
      reservePerDay: 0,
      rounds: 2,
      divisions: 2,
    });
    const schedule = generate(input);
    expect(schedule.diagnostics).toContain(
      "H8: Teams T0 and T2 play each other twice on 2027-06-01.",
    );
  });
});

describe("generate properties", () => {
  const options = { iterations: 2_000 };

  it(
    "P1: every generated schedule is valid, divisions included",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(arbitraryLeague({ divisions: true }), (input) => {
          const schedule = generate(input, options);
          expect(validate(input, schedule)).toEqual([]);
          expect(schedule.diagnostics.some((d) => /^H\d+: /.test(d))).toBe(
            false,
          );
        }),
        { numRuns: 150 },
      );
    },
  );

  it("P6: the same input gives the same schedule", { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(arbitraryLeague({ divisions: true }), (input) => {
        expect(generate(input, options)).toEqual(generate(input, options));
      }),
      { numRuns: 50 },
    );
  });
});

describe("generate edge cases", () => {
  it("has nothing to schedule for a single team", () => {
    const input = league({
      teams: 1,
      fields: 1,
      times: 2,
      dates: 2,
      gamesPerTeamPerDay: 1,
      reservePerDay: 0,
    });
    expect(generate(input)).toEqual({
      games: [],
      byes: [],
      unplaced: [],
      diagnostics: [],
    });
  });
});

describe("generate with pins on a tight date", () => {
  it("keeps pinned rounds where they are even when a game cannot fit", () => {
    // T0 can only play 1:00 on the first date, but pins put two of its
    // rounds there: one T0 game must go unplaced, and the pins stay.
    const base = league({
      teams: 4,
      fields: 1,
      times: 3,
      dates: 4,
      gamesPerTeamPerDay: 2,
      reservePerDay: 0,
      rounds: 4,
    });
    const free = generate(base);
    const without = (round: number) =>
      free.games.find(
        (g) => g.round === round && g.teamA !== "T0" && g.teamB !== "T0",
      ) as { key: string };
    const input = {
      ...base,
      constraints: [0, 1].map((timeIndex) => ({
        teamId: "T0",
        kind: "unavailable" as const,
        date: "2027-06-01",
        timeIndex,
      })),
      locked: [
        { gameKey: without(1).key, slotId: "2027-06-01/F0/0" },
        { gameKey: without(2).key, slotId: "2027-06-01/F0/1" },
      ],
    };
    const schedule = generate(input);
    expect(schedule.unplaced).toHaveLength(1);
    for (const lock of input.locked)
      expect(schedule.games.find((g) => g.key === lock.gameKey)?.slotId).toBe(
        lock.slotId,
      );
  });
});
