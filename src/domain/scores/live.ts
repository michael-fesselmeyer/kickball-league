import { MAX_RUNS, MIN_CALLED_INNINGS } from "./scores";

/**
 * Inning-by-inning live scoring (roadmap section 4, milestone 2).
 *
 * The ref, or a captain when the game has no ref, enters the runs scored in
 * each half-inning as the game goes. The line score is worked out from those
 * halves; the final score still goes through the report and confirmation
 * flow in ./scores.ts.
 *
 * - Halves are entered in order: top of the 1st, bottom of the 1st, top of
 *   the 2nd, and so on. Any half already entered can be corrected, and the
 *   last one can be taken back.
 * - Team A and team B are neutral names; who kicks in the top of each inning
 *   is decided at the field and recorded once per game.
 * - A called game counts with the score at the last complete inning
 *   (rulebook 3.1.5), so the runs of an unfinished inning are dropped.
 *
 * Pure: no database, no clock.
 */

export const HALVES = ["top", "bottom"] as const;
export type Half = (typeof HALVES)[number];

/** The most innings a game can have, extra innings included. */
export const MAX_INNINGS = 20;

export type Side = "A" | "B";

export type HalfInning = { inning: number; half: Half; runs: number };

export type Position = { inning: number; half: Half };

export type LineInning = {
  inning: number;
  /** Null while that team has not kicked in this inning. */
  a: number | null;
  b: number | null;
};

export type LineScore = {
  /** Every inning that has at least one half entered, in order. */
  innings: LineInning[];
  totalA: number;
  totalB: number;
  /** Innings in which both teams have kicked, counted from the 1st. */
  completeInnings: number;
  /** The last half entered, or null before the first. */
  last: Position | null;
  /** The next half to enter, or null once the last possible inning is in. */
  next: Position | null;
};

/** Which team kicks in a half, given who kicks first (in the top). */
export function sideFor(half: Half, kicksFirst: Side): Side {
  if (half === "top") return kicksFirst;
  return kicksFirst === "A" ? "B" : "A";
}

const order = (p: Position) => (p.inning - 1) * 2 + (p.half === "top" ? 0 : 1);
const positionAt = (index: number): Position => ({
  inning: Math.floor(index / 2) + 1,
  half: index % 2 === 0 ? "top" : "bottom",
});

/** The line score of a game from its entered halves. */
export function lineScore(
  halves: readonly HalfInning[],
  kicksFirst: Side,
): LineScore {
  const sorted = [...halves].sort((x, y) => order(x) - order(y));
  const byInning = new Map<number, LineInning>();
  let totalA = 0;
  let totalB = 0;
  for (const h of sorted) {
    const row = byInning.get(h.inning) ?? {
      inning: h.inning,
      a: null,
      b: null,
    };
    if (sideFor(h.half, kicksFirst) === "A") {
      row.a = h.runs;
      totalA += h.runs;
    } else {
      row.b = h.runs;
      totalB += h.runs;
    }
    byInning.set(h.inning, row);
  }
  const innings = [...byInning.values()];
  let completeInnings = 0;
  while (
    byInning.get(completeInnings + 1)?.a != null &&
    byInning.get(completeInnings + 1)?.b != null
  )
    completeInnings++;
  const last = sorted.at(-1);
  const nextIndex = last ? order(last) + 1 : 0;
  return {
    innings,
    totalA,
    totalB,
    completeInnings,
    last: last ? { inning: last.inning, half: last.half } : null,
    next: nextIndex < MAX_INNINGS * 2 ? positionAt(nextIndex) : null,
  };
}

export type CalledScore = {
  scoreA: number;
  scoreB: number;
  inningsPlayed: number;
};

/**
 * The score of a game called now: the runs through the last complete inning
 * (rulebook 3.1.5). Null when fewer than 4 innings are complete, because
 * such a game is not a result; the league treats it as a rain-out.
 */
export function calledScore(
  halves: readonly HalfInning[],
  kicksFirst: Side,
): CalledScore | null {
  const { completeInnings } = lineScore(halves, kicksFirst);
  if (completeInnings < MIN_CALLED_INNINGS) return null;
  const counted = halves.filter((h) => h.inning <= completeInnings);
  const { totalA, totalB } = lineScore(counted, kicksFirst);
  return { scoreA: totalA, scoreB: totalB, inningsPlayed: completeInnings };
}

export type HalfError = "invalid" | "out_of_order" | "too_many_runs";

/**
 * Whether `entry` may be saved: runs from 0 to 99, and either a correction of
 * a half already entered or the next half in order. A team's total stays
 * within what a final score can hold.
 */
export function checkHalf(
  halves: readonly HalfInning[],
  entry: HalfInning,
  kicksFirst: Side,
): HalfError | null {
  if (
    !Number.isInteger(entry.inning) ||
    entry.inning < 1 ||
    entry.inning > MAX_INNINGS ||
    !(HALVES as readonly string[]).includes(entry.half) ||
    !Number.isInteger(entry.runs) ||
    entry.runs < 0 ||
    entry.runs > MAX_RUNS
  )
    return "invalid";
  const same = (h: Position) =>
    h.inning === entry.inning && h.half === entry.half;
  const correcting = halves.some(same);
  const { next } = lineScore(halves, kicksFirst);
  if (!correcting && (!next || !same(next))) return "out_of_order";
  const after = lineScore(
    [...halves.filter((h) => !same(h)), entry],
    kicksFirst,
  );
  if (after.totalA > MAX_RUNS || after.totalB > MAX_RUNS)
    return "too_many_runs";
  return null;
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "Top of the 4th". */
export function positionLabel(p: Position): string {
  return `${p.half === "top" ? "Top" : "Bottom"} of the ${ordinal(p.inning)}`;
}

/** Innings in a regulation game (rulebook 3.1); the line score shows them all. */
export const REGULATION_INNINGS = 7;

/**
 * What the public game page shows and polls for: the halves so far, and
 * the official result once there is one. Sent as JSON, so plain data only.
 */
export type LiveSnapshot = {
  kicksFirst: Side | null;
  halves: HalfInning[];
  /** Final, forfeited or cancelled: nothing more will change. */
  closed: boolean;
  /** A final score has been reported and waits for confirmation. */
  reported: boolean;
  /** The official score once final; innings is set for a called game. */
  result: {
    scoreA: number;
    scoreB: number;
    inningsPlayed: number | null;
  } | null;
};
