import type { Random } from "../random";
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

export type RoundDays = {
  /** Date → the rounds played on it, in order. */
  days: { date: string; rounds: number[] }[];
  diagnostics: string[];
};

/**
 * Stage B: fills dates in order with up to `gamesPerTeamPerDay` rounds each,
 * leaving `reservePerDay` regular slots free for makeups. A shortfall is
 * reported, never dropped silently.
 */
export function assignRoundsToDates(
  rounds: readonly Round[],
  input: Pick<SchedulerInput, "slots" | "gamesPerTeamPerDay" | "reservePerDay">,
): RoundDays {
  const regularByDate = new Map<string, number>();
  for (const slot of input.slots) {
    if (slot.kind !== "regular") continue;
    regularByDate.set(slot.date, (regularByDate.get(slot.date) ?? 0) + 1);
  }
  const dates = [...regularByDate.keys()].sort();
  const gamesPerRound = Math.max(1, ...rounds.map((r) => r.games.length));

  const days: RoundDays["days"] = [];
  let next = 0;
  for (const date of dates) {
    if (next === rounds.length) break;
    const capacity = (regularByDate.get(date) ?? 0) - input.reservePerDay;
    const today = Math.min(
      input.gamesPerTeamPerDay,
      Math.floor(capacity / gamesPerRound),
      rounds.length - next,
    );
    if (today <= 0) continue;
    days.push({
      date,
      rounds: rounds.slice(next, next + today).map((r) => r.round),
    });
    next += today;
  }

  const diagnostics: string[] = [];
  const missing = rounds.length - next;
  if (missing > 0) {
    diagnostics.push(
      `Not enough slots: ${missing} round${missing === 1 ? "" : "s"} could not be given a date. Add dates or slots, or lower the makeup reserve.`,
    );
  }
  return { days, diagnostics };
}
