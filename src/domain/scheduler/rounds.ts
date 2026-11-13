import type { Random } from "../random";
import { minCostAssignment } from "./assignment";
import type { SchedulerInput } from "./types";

/** One round: every team plays once, except at most one team with a bye. */
export type Round = {
  /** 1-based. */
  round: number;
  games: [teamA: string, teamB: string][];
  bye: string | null;
};

const BYE = Symbol("bye");
type Seat = string | typeof BYE;

/**
 * Stage A (scheduling-algorithm.md, section 4): the circle method.
 *
 * One cycle is a complete round-robin, so playing cycles in order means no
 * pair meets twice before every pair has met once (H5). A BYE seat gives odd
 * team counts one bye per round, spread evenly (H7). Later cycles repeat the
 * first in the same order, so every rematch is a full cycle after the first
 * meeting (S7); alternate cycles swap home and away. The seed only decides
 * who sits where.
 */
export function buildRounds(
  teamIds: readonly string[],
  roundsWanted: number,
  random: Random,
): Round[] {
  if (teamIds.length < 2 || roundsWanted <= 0) return [];
  const order: Seat[] = random.shuffle(teamIds);
  if (order.length % 2 === 1) order.push(BYE);
  const n = order.length;

  const cycle: Omit<Round, "round">[] = [];
  for (let r = 0; r < n - 1; r++) {
    const games: [string, string][] = [];
    let bye: string | null = null;
    for (let i = 0; i < n / 2; i++) {
      const a = order[i] as Seat;
      const b = order[n - 1 - i] as Seat;
      if (a === BYE) bye = b as string;
      else if (b === BYE) bye = a;
      else games.push([a, b]);
    }
    cycle.push({ games, bye });
    // Rotate every seat but the first.
    order.splice(1, 0, order.pop() as Seat);
  }

  const result: Round[] = [];
  for (let c = 0; result.length < roundsWanted; c++) {
    for (const round of cycle) {
      if (result.length === roundsWanted) break;
      result.push({
        round: result.length + 1,
        games: c % 2 === 0 ? round.games : round.games.map(([a, b]) => [b, a]),
        bye: round.bye,
      });
    }
  }
  return result;
}

/** One crossover round: games between two divisions, and who sits it out. */
export type CrossoverRound = {
  games: [teamA: string, teamB: string][];
  byes: string[];
};

/**
 * Crossover rounds (scheduling-algorithm.md, section 5): extra rounds in
 * which every game is between the two divisions.
 *
 * In each round every team of the smaller division plays one team of the
 * larger, so each of them plays exactly `count` crossover games. The larger
 * division's teams take turns in a fixed order, so their crossover counts
 * differ by at most 1 (and equal `count` when the divisions are the same
 * size); the rest sit the round out. Within a round, opponents are matched
 * to keep repeat meetings to a minimum, so nobody meets the same crossover
 * opponent twice while a new one is free.
 */
export function buildCrossoverRounds(
  first: readonly string[],
  second: readonly string[],
  count: number,
  random: Random,
): CrossoverRound[] {
  if (count <= 0 || first.length === 0 || second.length === 0) return [];
  const [larger, smaller] =
    first.length >= second.length ? [first, second] : [second, first];
  const big = random.shuffle(larger);
  const small = random.shuffle(smaller);
  const met = new Map<string, number>();
  const pair = (a: string, b: string) => `${a}\u0000${b}`;

  const rounds: CrossoverRound[] = [];
  let next = 0;
  for (let r = 0; r < count; r++) {
    // The next teams of the larger division in turn, wrapping around.
    const turn = small.map((_, i) => big[(next + i) % big.length] as string);
    next = (next + small.length) % big.length;
    const columns = minCostAssignment(
      small.map((s) => turn.map((b) => met.get(pair(s, b)) ?? 0)),
    ) as number[];
    const games = small.map((s, i): [string, string] => {
      const b = turn[columns[i] as number] as string;
      met.set(pair(s, b), (met.get(pair(s, b)) ?? 0) + 1);
      return [b, s];
    });
    const playing = new Set(turn);
    rounds.push({ games, byes: big.filter((b) => !playing.has(b)) });
  }
  return rounds;
}

export type RoundDays = {
  /** Date → the rounds played on it, in order. */
  days: { date: string; rounds: number[] }[];
  diagnostics: string[];
};

/**
 * Stage B: fills dates in order with up to `gamesPerTeamPerDay` rounds each,
 * leaving `reservePerDay` regular slots free for makeups. A date takes fewer
 * rounds when a team could not make a different time for each of its games
 * there. A shortfall is reported, never dropped silently.
 */
export function assignRoundsToDates(
  rounds: readonly Round[],
  input: Pick<
    SchedulerInput,
    "slots" | "gamesPerTeamPerDay" | "reservePerDay"
  > &
    Partial<Pick<SchedulerInput, "constraints">>,
  /** Most rounds a date may take, for dates that proved too tight. */
  roundCap: ReadonlyMap<string, number> = new Map(),
  /** Rounds that must be played on a date, because a game in them is pinned. */
  pinned: ReadonlyMap<number, string> = new Map(),
): RoundDays {
  const regularByDate = new Map<string, number>();
  const timesByDate = new Map<string, Set<number>>();
  for (const slot of input.slots) {
    if (slot.kind !== "regular") continue;
    regularByDate.set(slot.date, (regularByDate.get(slot.date) ?? 0) + 1);
    const times = timesByDate.get(slot.date) ?? new Set<number>();
    timesByDate.set(slot.date, times.add(slot.timeIndex));
  }
  const unavailable = (input.constraints ?? []).filter(
    (c) => c.kind === "unavailable",
  );
  /**
   * Several rounds fit on a date only if every team has a different time
   * it can make for each game it plays there.
   */
  const everyoneFits = (date: string, todays: readonly Round[]) => {
    const times = [...(timesByDate.get(date) as Set<number>)];
    const plays = new Map<string, number>();
    for (const round of todays)
      for (const team of round.games.flat())
        plays.set(team, (plays.get(team) ?? 0) + 1);
    for (const [team, games] of plays) {
      const free = times.filter(
        (t) =>
          !unavailable.some(
            (c) =>
              c.teamId === team &&
              (c.date === undefined || c.date === date) &&
              (c.timeIndex === undefined || c.timeIndex === t),
          ),
      ).length;
      if (games > free) return false;
    }
    return true;
  };
  const dates = [...regularByDate].sort(([a], [b]) => a.localeCompare(b));
  const gamesPerRound = Math.max(1, ...rounds.map((r) => r.games.length));

  // Pinned rounds go on their dates first; the rest fill the room left, in
  // order.
  const byDate = new Map<string, Round[]>();
  for (const round of rounds) {
    const date = pinned.get(round.round);
    if (date !== undefined && regularByDate.has(date))
      byDate.set(date, [...(byDate.get(date) ?? []), round]);
  }
  const placedRounds = new Set([...byDate.values()].flat().map((r) => r.round));
  const waiting = rounds.filter((r) => !placedRounds.has(r.round));
  let next = 0;
  for (const [date, regularSlots] of dates) {
    const already = byDate.get(date) ?? [];
    const capacity = regularSlots - input.reservePerDay;
    let today = Math.min(
      input.gamesPerTeamPerDay - already.length,
      (roundCap.get(date) ?? Infinity) - already.length,
      Math.floor(capacity / gamesPerRound) - already.length,
      waiting.length - next,
    );
    while (
      today > 0 &&
      already.length + today > 1 &&
      !everyoneFits(date, [...already, ...waiting.slice(next, next + today)])
    )
      today--;
    if (today > 0) {
      byDate.set(date, [...already, ...waiting.slice(next, next + today)]);
      next += today;
    }
  }
  const days: RoundDays["days"] = dates.flatMap(([date]) => {
    const todays = byDate.get(date);
    return todays
      ? [{ date, rounds: todays.map((r) => r.round).sort((a, b) => a - b) }]
      : [];
  });

  const diagnostics: string[] = [];
  const missing = waiting.length - next;
  if (missing > 0) {
    diagnostics.push(
      `Not enough slots: ${missing} round${missing === 1 ? "" : "s"} could not be given a date. Add dates or slots, or lower the makeup reserve.`,
    );
  }
  return { days, diagnostics };
}
