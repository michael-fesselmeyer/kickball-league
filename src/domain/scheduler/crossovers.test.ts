/**
 * Divisions with crossover games (scheduling-algorithm.md, sections 5 and
 * 11): P15 to P17, and examples.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRandom } from "../random";
import { generate } from "./generate";
import { arbitraryCrossoverLeague, league } from "./league.fixture";
import { measure } from "./measure";
import { buildCrossoverRounds } from "./rounds";
import type { Schedule, SchedulerInput } from "./types";
import { validate } from "./validate";

const options = { iterations: 1_500 };

/** Each team's crossover games, and the pairs that met in them. */
function crossovers(input: SchedulerInput, schedule: Schedule) {
  const division = new Map(input.teams.map((t) => [t.id, t.divisionId]));
  const games = schedule.games.filter(
    (g) => division.get(g.teamA) !== division.get(g.teamB),
  );
  const count = new Map(input.teams.map((t) => [t.id, 0]));
  for (const g of games)
    for (const team of [g.teamA, g.teamB])
      count.set(team, (count.get(team) ?? 0) + 1);
  const pairs = Map.groupBy(games, (g) => [g.teamA, g.teamB].sort().join("-"));
  return { games, count, pairs };
}

const divisionsOf = (input: SchedulerInput) =>
  [...Map.groupBy(input.teams, (t) => t.divisionId).values()]
    .map((teams) => teams.map((t) => t.id))
    .sort((a, b) => a.length - b.length) as [string[], string[]];

describe("crossover properties", () => {
  it(
    "P15: every team plays exactly its crossover count, or the closest even share in the larger division",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(arbitraryCrossoverLeague(), (input) => {
          const schedule = generate(input, options);
          const { count } = crossovers(input, schedule);
          const [smaller, larger] = divisionsOf(input);
          const k = input.crossoverGames ?? 0;
          for (const team of smaller) expect(count.get(team)).toBe(k);
          const share = (k * smaller.length) / larger.length;
          for (const team of larger) {
            const plays = count.get(team) ?? 0;
            expect(plays).toBeGreaterThanOrEqual(Math.floor(share));
            expect(plays).toBeLessThanOrEqual(Math.ceil(share));
          }
          // The same size: every team plays exactly k.
          if (smaller.length === larger.length)
            for (const team of larger) expect(count.get(team)).toBe(k);
          // No crossover rematch while the larger division has a new opponent.
          if (k <= larger.length)
            for (const games of crossovers(input, schedule).pairs.values())
              expect(games).toHaveLength(1);
        }),
        { numRuns: 150 },
      );
    },
  );

  it(
    "P16: within each division the round robin stays balanced around crossovers",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(arbitraryCrossoverLeague(), (input) => {
          const schedule = generate(input, options);
          for (const members of divisionsOf(input)) {
            const inside = new Set(members);
            const meetings = new Map<string, number>();
            for (let i = 0; i < members.length; i++)
              for (let j = i + 1; j < members.length; j++)
                meetings.set([members[i], members[j]].sort().join("-"), 0);
            for (const g of schedule.games)
              if (inside.has(g.teamA) && inside.has(g.teamB)) {
                const key = [g.teamA, g.teamB].sort().join("-");
                meetings.set(key, (meetings.get(key) ?? 0) + 1);
              }
            const counts = [...meetings.values()];
            expect(
              Math.max(...counts) - Math.min(...counts),
            ).toBeLessThanOrEqual(1);
            // Every team plays the division's rounds: one game or a bye each.
            const divisionGames = schedule.games.filter(
              (g) => inside.has(g.teamA) && inside.has(g.teamB),
            );
            expect(divisionGames.length).toBe(
              Math.floor(members.length / 2) * input.rounds,
            );
          }
        }),
        { numRuns: 150 },
      );
    },
  );

  it(
    "P17: crossovers keep every hard constraint: valid, deterministic, nothing dropped",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(arbitraryCrossoverLeague(), (input) => {
          const schedule = generate(input, options);
          expect(validate(input, schedule)).toEqual([]);
          expect(schedule.diagnostics.some((d) => /^H\d+: /.test(d))).toBe(
            false,
          );
          // P4: every game is placed once or listed as unplaced.
          expect(schedule.unplaced).toEqual(
            schedule.games.filter((g) => g.slotId === null).map((g) => g.key),
          );
          expect(new Set(schedule.games.map((g) => g.key)).size).toBe(
            schedule.games.length,
          );
          expect(generate(input, options)).toEqual(schedule);
        }),
        { numRuns: 100 },
      );
    },
  );
});

describe("crossover rounds", () => {
  const random = () => seededRandom(7);

  it("has none to build without a count or a team on each side", () => {
    expect(buildCrossoverRounds(["A", "B"], ["C", "D"], 0, random())).toEqual(
      [],
    );
    expect(buildCrossoverRounds([], ["C", "D"], 2, random())).toEqual([]);
  });

  it("pairs divisions of one size fully, with a new opponent each round", () => {
    const rounds = buildCrossoverRounds(
      ["A", "B", "C"],
      ["X", "Y", "Z"],
      3,
      random(),
    );
    expect(rounds).toHaveLength(3);
    for (const round of rounds) {
      expect(round.byes).toEqual([]);
      expect(round.games).toHaveLength(3);
    }
    const pairs = rounds.flatMap((r) =>
      r.games.map(([a, b]) => [a, b].sort().join("-")),
    );
    expect(new Set(pairs).size).toBe(9);
  });

  it("takes the larger division in turns, so its teams sit out evenly", () => {
    // The smaller division is passed first; it still gets every game.
    const rounds = buildCrossoverRounds(
      ["X", "Y"],
      ["A", "B", "C", "D", "E"],
      4,
      random(),
    );
    const plays = new Map<string, number>();
    for (const round of rounds) {
      expect(round.byes).toHaveLength(3);
      for (const team of round.games.flat())
        plays.set(team, (plays.get(team) ?? 0) + 1);
    }
    expect([plays.get("X"), plays.get("Y")]).toEqual([4, 4]);
    const larger = ["A", "B", "C", "D", "E"].map((t) => plays.get(t) ?? 0);
    expect(Math.max(...larger) - Math.min(...larger)).toBeLessThanOrEqual(1);
  });

  it("repeats an opponent only once every one has been played", () => {
    const rounds = buildCrossoverRounds(["A", "B"], ["X", "Y"], 3, random());
    const pairs = rounds.flatMap((r) =>
      r.games.map(([a, b]) => [a, b].sort().join("-")),
    );
    expect(new Set(pairs.slice(0, 4)).size).toBe(4);
  });
});

describe("generate with crossovers", () => {
  const base = league({
    teams: 8,
    fields: 2,
    times: 3,
    dates: 8,
    gamesPerTeamPerDay: 1,
    reservePerDay: 0,
    rounds: 5,
    divisions: 2,
    crossoverGames: 2,
  });

  it("spreads crossover rounds through the season", () => {
    const schedule = generate(base, options);
    expect(schedule.diagnostics).toEqual([]);
    expect(validate(base, schedule)).toEqual([]);
    const division = new Map(base.teams.map((t) => [t.id, t.divisionId]));
    const crossoverRounds = [
      ...new Set(
        schedule.games
          .filter((g) => division.get(g.teamA) !== division.get(g.teamB))
          .map((g) => g.round),
      ),
    ].sort((a, b) => a - b);
    // Five division rounds and two crossovers: after rounds 1 and 3.
    expect(crossoverRounds).toEqual([2, 5]);
    expect(Math.max(...schedule.games.map((g) => g.round))).toBe(7);
    expect(measure(base, schedule).byeBalance.value).toBe(0);
  });

  it("lists the larger division's sit-outs as byes, outside bye balance", () => {
    const input = league({
      teams: 7,
      fields: 2,
      times: 3,
      dates: 6,
      gamesPerTeamPerDay: 1,
      reservePerDay: 0,
      rounds: 3,
      divisions: 2,
      split: 4,
      crossoverGames: 1,
    });
    const schedule = generate(input, options);
    expect(validate(input, schedule)).toEqual([]);
    const crossover = schedule.games.find((g) => g.round === 2);
    expect(crossover).toBeDefined();
    // Four against three: one team of the four sits the crossover out.
    expect(schedule.byes.filter((b) => b.round === 2)).toHaveLength(1);
    // The three-team division has a bye each division round.
    expect(measure(input, schedule).byeBalance.value).toBe(0);
  });

  it("says why there are no crossovers without exactly two divisions", () => {
    for (const divisions of [1, 3]) {
      const input = league({
        teams: 9,
        fields: 2,
        times: 3,
        dates: 6,
        gamesPerTeamPerDay: 1,
        reservePerDay: 0,
        rounds: 2,
        divisions,
        crossoverGames: 2,
      });
      const schedule = generate(input, options);
      expect(schedule.diagnostics).toEqual([
        "Crossover games need exactly two divisions, so none were scheduled.",
      ]);
      expect(validate(input, schedule)).toEqual([]);
    }
  });

  it("plays crossovers first in a season with no division rounds", () => {
    const input = { ...base, rounds: 0 };
    const schedule = generate(input, options);
    expect(schedule.games).toHaveLength(8);
    expect(validate(input, schedule)).toEqual([]);
  });
});
