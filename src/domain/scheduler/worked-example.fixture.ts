/**
 * Test data: the worked example in scheduling-algorithm.md, section 9.
 * Eight teams, two fields, three times (10:00, 11:30, 1:00) on seven Sundays,
 * one game per team per day and two slots kept for makeups.
 */
import {
  DEFAULT_WEIGHTS,
  gameKey,
  type Schedule,
  type SchedulerInput,
  type Slot,
} from "./types";

export const SUNDAYS = [
  "2027-04-04",
  "2027-04-11",
  "2027-04-18",
  "2027-04-25",
  "2027-05-02",
  "2027-05-09",
  "2027-05-16",
] as const;

/** Each row is a week; each cell a time as "field 1 / field 2"; "·" is empty. */
type Grid = readonly (readonly string[])[];

/** The section 9 rounds dealt into slots in order: the "naive placement". */
export const NAIVE: Grid = [
  ["A-H/B-G", "C-F/D-E", "·/·"],
  ["A-G/H-F", "B-E/C-D", "·/·"],
  ["A-F/G-E", "H-D/B-C", "·/·"],
  ["A-E/F-D", "G-C/H-B", "·/·"],
  ["A-D/E-C", "F-B/G-H", "·/·"],
  ["A-C/D-B", "E-H/F-G", "·/·"],
  ["A-B/C-H", "D-G/E-F", "·/·"],
];

/** The schedule simulated annealing found in section 9. */
export const OPTIMIZED: Grid = [
  ["B-G/·", "D-E/A-H", "·/C-F"],
  ["B-E/A-G", "H-F/C-D", "·/·"],
  ["H-D/·", "A-F/·", "B-C/G-E"],
  ["·/F-D", "·/G-C", "A-E/H-B"],
  ["·/F-B", "E-C/G-H", "·/A-D"],
  ["·/A-C", "·/D-B", "F-G/E-H"],
  ["C-H/E-F", "A-B/·", "D-G/·"],
];

/** Week, field and time are 0-based. */
export const slotId = (week: number, field: number, time: number) =>
  `${SUNDAYS[week]}/F${field + 1}/${time}`;

export function slot(
  id: string,
  date: string,
  fieldId: string,
  timeIndex: number,
): Slot {
  return {
    id,
    fieldId,
    date,
    timeIndex,
    startsAt: `${date}T14:00:00.000Z`,
    endsAt: `${date}T15:30:00.000Z`,
    kind: "regular",
  };
}

/** The worked example's input and a schedule from a grid; round k is week k. */
export function workedExample(
  overrides: Partial<SchedulerInput> = {},
  grid: Grid = OPTIMIZED,
): [SchedulerInput, Schedule] {
  const slots: Slot[] = [];
  const games: Schedule["games"] = [];
  grid.forEach((times, week) =>
    times.forEach((cell, time) =>
      cell.split("/").forEach((game, field) => {
        const id = slotId(week, field, time);
        slots.push(slot(id, SUNDAYS[week] as string, `F${field + 1}`, time));
        if (game === "·") return;
        const [teamA, teamB] = game.split("-") as [string, string];
        games.push({
          key: gameKey(week + 1, teamA, teamB),
          round: week + 1,
          teamA,
          teamB,
          slotId: id,
        });
      }),
    ),
  );
  const input: SchedulerInput = {
    teams: "ABCDEFGH".split("").map((id) => ({ id })),
    slots,
    rounds: 7,
    gamesPerTeamPerDay: 1,
    reservePerDay: 2,
    constraints: [],
    locked: [],
    weights: DEFAULT_WEIGHTS,
    seed: 1,
    ...overrides,
  };
  return [input, { games, byes: [], unplaced: [], diagnostics: [] }];
}

/** Moves the game between two teams in a round to another slot, or unplaces it. */
export function move(
  schedule: Schedule,
  round: number,
  pair: string,
  to: string | null,
): Schedule {
  const [a, b] = pair.split("-") as [string, string];
  const key = gameKey(round, a, b);
  if (!schedule.games.some((g) => g.key === key))
    throw new Error(`No game ${key}`);
  return {
    ...schedule,
    games: schedule.games.map((g) =>
      g.key === key ? { ...g, slotId: to } : g,
    ),
  };
}
