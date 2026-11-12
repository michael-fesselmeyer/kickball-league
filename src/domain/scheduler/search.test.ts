import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRandom } from "../random";
import { scheduleCost } from "./cost";
import { arbitraryLeague } from "./league.fixture";
import { measure } from "./measure";
import { constructPlacement } from "./placement";
import { assignRoundsToDates, buildRounds } from "./rounds";
import { localSearch } from "./search";
import type { SchedulerInput } from "./types";
import { validate } from "./validate";
import { NAIVE, slotId, workedExample } from "./worked-example.fixture";

/** Stages A to C1, the starting point for the search. */
function firstPlacement(input: SchedulerInput) {
  const random = seededRandom(input.seed);
  const rounds = buildRounds(
    input.teams.map((t) => t.id),
    input.rounds,
    random,
  );
  const { days } = assignRoundsToDates(rounds, input);
  return constructPlacement(rounds, days, input);
}

describe("localSearch", () => {
  it("turns the naive placement into a best-possible schedule", () => {
    const [input, naive] = workedExample({}, NAIVE);
    const searched = localSearch(naive, input, seededRandom(1));
    expect(validate(input, searched)).toEqual([]);
    const m = measure(input, searched);
    expect([m.timeSlotSpread.value, m.fieldSpread.value]).toEqual([1, 1]);
    expect(m.longestStreak.value).toBeLessThanOrEqual(2);
  });

  it("never moves a locked game, or another game into its slot", () => {
    const locked = [
      { gameKey: "r1:A:H", slotId: slotId(0, 0, 0) },
      { gameKey: "r2:A:G", slotId: slotId(1, 0, 0) },
    ];
    const [input, naive] = workedExample({ locked }, NAIVE);
    const searched = localSearch(naive, input, seededRandom(2), {
      iterations: 20_000,
    });
    expect(validate(input, searched)).toEqual([]);
  });

  it("respects unavailability while moving games", () => {
    const constraints = [
      { teamId: "B", kind: "unavailable" as const, timeIndex: 0 },
    ];
    const [input, naive] = workedExample({ constraints }, NAIVE);
    const start = {
      ...naive,
      games: naive.games.map((g) =>
        g.teamA === "B" || g.teamB === "B" ? { ...g, slotId: null } : g,
      ),
    };
    const searched = localSearch(start, input, seededRandom(3), {
      iterations: 20_000,
    });
    expect(validate(input, searched)).toEqual([]);
  });

  it("returns the schedule unchanged with nothing to move or no iterations", () => {
    const [input, schedule] = workedExample();
    expect(
      localSearch(schedule, input, seededRandom(1), { iterations: 0 }),
    ).toBe(schedule);
    const allLocked = schedule.games.map((g) => ({
      gameKey: g.key,
      slotId: g.slotId as string,
    }));
    expect(
      localSearch(schedule, { ...input, locked: allLocked }, seededRandom(1)),
    ).toBe(schedule);
  });
});

describe("localSearch properties", () => {
  it("P7: never makes the cost worse, and keeps every hard constraint", () => {
    fc.assert(
      fc.property(arbitraryLeague(), (input) => {
        const start = firstPlacement(input);
        const searched = localSearch(start, input, seededRandom(input.seed), {
          iterations: 3_000,
        });
        expect(scheduleCost(input, searched)).toBeLessThanOrEqual(
          scheduleCost(input, start) + 1e-6,
        );
        expect(validate(input, searched)).toEqual(validate(input, start));
      }),
      { numRuns: 150 },
    );
  });
});
