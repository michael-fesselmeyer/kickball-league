import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRandom, type Random } from "../random";
import { assignRoundsToDates, buildRounds, type Round } from "./rounds";
import type { Slot } from "./types";

/** A "random" source that keeps the input order, to reproduce the worked example. */
const inOrder: Random = { ...seededRandom(0), shuffle: (items) => [...items] };

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
const pairs = (round: Round) => round.games.map(([a, b]) => `${a}-${b}`);

describe("buildRounds (stage A)", () => {
  it("reproduces the worked example in scheduling-algorithm.md, section 9", () => {
    expect(buildRounds(teams(8), 7, inOrder).map(pairs)).toEqual([
      ["A-H", "B-G", "C-F", "D-E"],
      ["A-G", "H-F", "B-E", "C-D"],
      ["A-F", "G-E", "H-D", "B-C"],
      ["A-E", "F-D", "G-C", "H-B"],
      ["A-D", "E-C", "F-B", "G-H"],
      ["A-C", "D-B", "E-H", "F-G"],
      ["A-B", "C-H", "D-G", "E-F"],
    ]);
  });

  it("gives odd team counts one bye per round", () => {
    const rounds = buildRounds(teams(5), 5, inOrder);
    expect(rounds.every((r) => r.games.length === 2 && r.bye !== null)).toBe(
      true,
    );
    expect(new Set(rounds.map((r) => r.bye)).size).toBe(5);
  });

  it("repeats the cycle in order with home and away swapped", () => {
    const rounds = buildRounds(teams(4), 6, inOrder);
    const swapped = (round: Round) => round.games.map(([a, b]) => `${b}-${a}`);
    expect(rounds.slice(3).map(pairs)).toEqual(rounds.slice(0, 3).map(swapped));
  });

  it("stops part-way through a cycle when fewer rounds are wanted", () => {
    expect(buildRounds(teams(8), 3, inOrder)).toHaveLength(3);
  });

  it("returns nothing for fewer than two teams or no rounds", () => {
    expect(buildRounds(["A"], 3, inOrder)).toEqual([]);
    expect(buildRounds(teams(4), 0, inOrder)).toEqual([]);
  });
});

const roundsInput = fc.record({
  teamCount: fc.integer({ min: 2, max: 24 }),
  rounds: fc.integer({ min: 1, max: 30 }),
  seed: fc.integer(),
});

describe("buildRounds properties", () => {
  it("P2: no pair meets twice before every pair has met once", () => {
    fc.assert(
      fc.property(roundsInput, ({ teamCount, rounds, seed }) => {
        const meetings = new Map<string, number>();
        const ids = teams(teamCount);
        for (const round of buildRounds(ids, rounds, seededRandom(seed))) {
          for (const [a, b] of round.games) {
            const key = [a, b].sort().join("-");
            meetings.set(key, (meetings.get(key) ?? 0) + 1);
          }
          // After each round, every pair's meeting count differs by at most 1.
          const counts: number[] = [];
          for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++)
              counts.push(meetings.get(`${ids[i]}-${ids[j]}`) ?? 0);
          expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(
            1,
          );
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("P5: each team plays at most once per round; odd counts get exactly one bye, spread evenly", () => {
    fc.assert(
      fc.property(roundsInput, ({ teamCount, rounds, seed }) => {
        const built = buildRounds(teams(teamCount), rounds, seededRandom(seed));
        const byes = new Map<string, number>();
        for (const round of built) {
          const playing = round.games.flat();
          expect(new Set(playing).size).toBe(playing.length);
          if (teamCount % 2 === 1) {
            expect(round.bye).not.toBeNull();
            byes.set(
              round.bye as string,
              (byes.get(round.bye as string) ?? 0) + 1,
            );
          } else {
            expect(round.bye).toBeNull();
          }
        }
        if (teamCount % 2 === 1) {
          const counts = teams(teamCount).map((t) => byes.get(t) ?? 0);
          expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(
            1,
          );
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("S7: every rematch comes exactly one cycle after the previous meeting", () => {
    fc.assert(
      fc.property(roundsInput, ({ teamCount, rounds, seed }) => {
        const cycleLength = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
        const lastMet = new Map<string, number>();
        for (const round of buildRounds(
          teams(teamCount),
          rounds,
          seededRandom(seed),
        )) {
          for (const [a, b] of round.games) {
            const key = [a, b].sort().join("-");
            const previous = lastMet.get(key);
            if (previous !== undefined)
              expect(round.round - previous).toBe(cycleLength);
            lastMet.set(key, round.round);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("is deterministic for a seed", () => {
    expect(buildRounds(teams(9), 12, seededRandom(42))).toEqual(
      buildRounds(teams(9), 12, seededRandom(42)),
    );
  });
});

/** `count` regular slots on each date. */
const slotsOn = (dates: string[], count: number): Slot[] =>
  dates.flatMap((date) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${date}#${i}`,
      fieldId: `f${i % 2}`,
      date,
      timeIndex: Math.floor(i / 2),
      startsAt: `${date}T00:00:00Z`,
      endsAt: `${date}T01:00:00Z`,
      kind: "regular" as const,
    })),
  );

describe("assignRoundsToDates (stage B)", () => {
  const eightTeams = buildRounds(teams(8), 7, inOrder);
  const sundays = [
    "2027-04-04",
    "2027-04-11",
    "2027-04-18",
    "2027-04-25",
    "2027-05-02",
    "2027-05-09",
    "2027-05-16",
  ];

  it("plays one round per date, in order, as in the worked example", () => {
    const { days, diagnostics } = assignRoundsToDates(eightTeams, {
      slots: slotsOn(sundays, 6),
      gamesPerTeamPerDay: 1,
      reservePerDay: 2,
    });
    expect(days.map((d) => d.rounds)).toEqual([
      [1],
      [2],
      [3],
      [4],
      [5],
      [6],
      [7],
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("plays two rounds on a doubleheader date when the slots allow", () => {
    const { days } = assignRoundsToDates(eightTeams, {
      slots: slotsOn(sundays.slice(0, 4), 8),
      gamesPerTeamPerDay: 2,
      reservePerDay: 0,
    });
    expect(days.map((d) => d.rounds)).toEqual([[1, 2], [3, 4], [5, 6], [7]]);
  });

  it("skips dates whose free slots cannot hold a round, and reports a shortfall", () => {
    const slots = [
      ...slotsOn(["2027-04-04"], 3),
      ...slotsOn(["2027-04-11"], 6),
    ];
    const { days, diagnostics } = assignRoundsToDates(eightTeams, {
      slots,
      gamesPerTeamPerDay: 1,
      reservePerDay: 0,
    });
    expect(days).toEqual([{ date: "2027-04-11", rounds: [1] }]);
    expect(diagnostics).toEqual([
      "Not enough slots: 6 rounds could not be given a date. Add dates or slots, or lower the makeup reserve.",
    ]);
  });

  it("ignores playoff and reserve slots, and says 'round' for a single missing round", () => {
    const slots = [
      ...slotsOn(["2027-04-04"], 4),
      ...slotsOn(["2027-04-11"], 4).map((s) => ({
        ...s,
        kind: "playoff" as const,
      })),
    ];
    const { diagnostics } = assignRoundsToDates(eightTeams.slice(0, 2), {
      slots,
      gamesPerTeamPerDay: 1,
      reservePerDay: 0,
    });
    expect(diagnostics).toEqual([
      "Not enough slots: 1 round could not be given a date. Add dates or slots, or lower the makeup reserve.",
    ]);
  });
});
