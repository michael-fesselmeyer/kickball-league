import { isOneOf } from "@/domain/guards";
import { HALVES, type HalfInning, type Position } from "./live";
import { MAX_RUNS } from "./scores";

/**
 * The runs counted so far in the half-inning being played, one "+1 run" tap
 * at a time. The count lives only on the scorer's phone until "End half"
 * saves it as that half's runs, so a half is still saved once, in order,
 * the way ADR 0011 stores it. A half that has ended is the only thing the
 * server or anyone else sees.
 */
export type Tally = Position & { runs: number };

/** Where a game's count is kept on the phone. */
export const tallyKey = (gameId: string) => `kb-live-tally:${gameId}`;

/** A stored count, or null when there is none or it isn't one. */
export function parseTally(raw: string | null): Tally | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const inning = "inning" in value ? value.inning : null;
  const half = "half" in value ? value.half : null;
  const runs = "runs" in value ? value.runs : null;
  return typeof inning === "number" &&
    Number.isInteger(inning) &&
    inning >= 1 &&
    isOneOf(HALVES, half) &&
    typeof runs === "number" &&
    Number.isInteger(runs) &&
    runs >= 0 &&
    runs <= MAX_RUNS
    ? { inning, half, runs }
    : null;
}

/**
 * The runs counted for the half being played. A count kept for any other
 * half (one since saved, or one a correction moved past) counts for nothing.
 */
export function runsSoFar(stored: Tally | null, next: Position | null): number {
  return stored &&
    next &&
    stored.inning === next.inning &&
    stored.half === next.half
    ? stored.runs
    : 0;
}

/** One more run in the half being played, up to the most a half can hold. */
export const addRun = (next: Position, runs: number): Tally => ({
  ...next,
  runs: Math.min(runs + 1, MAX_RUNS),
});

/**
 * What "Undo" takes back: the last "+1 run" while this half has any, or
 * else the last half saved, whose runs go back on the counter so play
 * carries on from where it was before "End half".
 */
export type UndoStep =
  { kind: "run"; tally: Tally } | { kind: "half"; tally: Tally } | null;

export function undoStep(
  next: Position | null,
  runs: number,
  last: HalfInning | null,
): UndoStep {
  if (next && runs > 0)
    return { kind: "run", tally: { ...next, runs: runs - 1 } };
  if (last)
    return {
      kind: "half",
      tally: { inning: last.inning, half: last.half, runs: last.runs },
    };
  return null;
}
