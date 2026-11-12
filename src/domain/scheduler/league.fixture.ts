/** Test data: leagues of every shape, for property tests of the scheduler. */
import fc from "fast-check";
import { DEFAULT_WEIGHTS, type SchedulerInput, type Slot } from "./types";
import { slot } from "./worked-example.fixture";

export type LeagueShape = {
  teams: number;
  fields: number;
  times: number;
  dates: number;
  gamesPerTeamPerDay: 1 | 2;
  reservePerDay: number;
  rounds?: number;
  /** Split teams into this many divisions. */
  divisions?: number;
  seed?: number;
};

/** A league with `fields × times` regular slots on each of `dates` days. */
export function league(shape: LeagueShape): SchedulerInput {
  const ids = Array.from({ length: shape.teams }, (_, i) => `T${i}`);
  const dates = Array.from(
    { length: shape.dates },
    (_, d) => `2027-06-${String(d + 1).padStart(2, "0")}`,
  );
  const slots: Slot[] = dates.flatMap((date) =>
    Array.from({ length: shape.fields * shape.times }, (_, k) => {
      const field = k % shape.fields;
      const time = Math.floor(k / shape.fields);
      return slot(`${date}/F${field}/${time}`, date, `F${field}`, time);
    }),
  );
  const divisions = shape.divisions ?? 1;
  return {
    teams: ids.map((id, i) =>
      divisions > 1 ? { id, divisionId: `D${i % divisions}` } : { id },
    ),
    slots,
    rounds: shape.rounds ?? shape.teams,
    gamesPerTeamPerDay: shape.gamesPerTeamPerDay,
    reservePerDay: shape.reservePerDay,
    constraints: [],
    locked: [],
    weights: DEFAULT_WEIGHTS,
    seed: shape.seed ?? 1,
  };
}

/** Random leagues: 4 to 12 teams, 1 to 3 fields, 2 to 4 times, 4 to 10 dates. */
export const arbitraryLeague = (options: { divisions?: boolean } = {}) =>
  fc
    .record({
      teams: fc.integer({ min: 4, max: 12 }),
      fields: fc.integer({ min: 1, max: 3 }),
      times: fc.integer({ min: 2, max: 4 }),
      dates: fc.integer({ min: 4, max: 10 }),
      gamesPerTeamPerDay: fc.constantFrom(1 as const, 2 as const),
      reservePerDay: fc.integer({ min: 0, max: 2 }),
      divisions: options.divisions
        ? fc.integer({ min: 1, max: 2 })
        : fc.constant(1),
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
    .map(({ unavailable, ...shape }): SchedulerInput => {
      // Divisions of at least 3: a 2-team division cannot play doubleheaders
      // without meeting the same opponent twice in a day.
      const divisions = shape.teams >= 6 ? shape.divisions : 1;
      const input = league({ ...shape, divisions });
      const dates = [...new Set(input.slots.map((s) => s.date))];
      return {
        ...input,
        constraints: unavailable.map((u) => ({
          teamId: input.teams[u.team % input.teams.length]?.id as string,
          kind: "unavailable" as const,
          ...(u.date === undefined
            ? {}
            : { date: dates[u.date % dates.length] as string }),
          ...(u.time === undefined ? {} : { timeIndex: u.time % shape.times }),
        })),
      };
    });
