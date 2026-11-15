import { isOneOf } from "@/domain/guards";
import { err, ok, type Result } from "@/domain/result";
import { SHIRT_SIZES, type ShirtSize } from "./summary";

/**
 * Shirts for players who join after the season's order went in
 * (product-spec.md, section 6, "Late joiners"): a league-wide waiting list
 * by team and size, the league's spare stock, and when enough have built
 * up for a batch reorder. Pure, so the rules are tested without a database.
 */

/**
 * A small reorder costs too much per shirt below this many. Vendors'
 * minimums for a custom print run vary; twelve is the usual smallest.
 */
export const BATCH_MINIMUM = 12;

export type WaitingPlayer = {
  teamName: string;
  size: ShirtSize;
};

export type TeamWaiting = {
  teamName: string;
  bySize: Partial<Record<ShirtSize, number>>;
  total: number;
};

export type WaitingSummary = {
  /** Everyone waiting, by size. */
  bySize: Record<ShirtSize, number>;
  /** Each team's waiting players, by size, teams by name. */
  byTeam: TeamWaiting[];
  total: number;
  /** Per size, what is left to order once the spare stock is handed out. */
  afterSpares: Record<ShirtSize, number>;
  toOrder: number;
  /** Enough have built up that a batch is worth ordering. */
  batchReady: boolean;
  /** How many more are needed before it is; 0 once ready. */
  stillNeeded: number;
};

const zeroes = (): Record<ShirtSize, number> => ({
  xs: 0,
  s: 0,
  m: 0,
  l: 0,
  xl: 0,
  xxl: 0,
  xxxl: 0,
});

/**
 * The waiting list across teams. Spare shirts of a size cover that size's
 * waiting players first, so only what the spares don't cover counts toward
 * a batch; spare left over in one size does not reduce another size.
 */
export function summarizeWaiting(
  players: readonly WaitingPlayer[],
  spare: Partial<Record<ShirtSize, number>>,
  minimum: number = BATCH_MINIMUM,
): WaitingSummary {
  const bySize = zeroes();
  const teams = new Map<string, Partial<Record<ShirtSize, number>>>();
  for (const p of players) {
    bySize[p.size]++;
    const row = teams.get(p.teamName) ?? {};
    row[p.size] = (row[p.size] ?? 0) + 1;
    teams.set(p.teamName, row);
  }
  const afterSpares = zeroes();
  let toOrder = 0;
  for (const size of SHIRT_SIZES) {
    afterSpares[size] = Math.max(
      0,
      bySize[size] - Math.max(0, spare[size] ?? 0),
    );
    toOrder += afterSpares[size];
  }
  return {
    bySize,
    byTeam: [...teams.entries()]
      .map(([teamName, row]) => ({
        teamName,
        bySize: row,
        total: Object.values(row).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName)),
    total: players.length,
    afterSpares,
    toOrder,
    batchReady: toOrder >= minimum,
    stillNeeded: Math.max(0, minimum - toOrder),
  };
}

export type SpareError = "bad_size" | "bad_quantity" | "note_too_long";

export const SPARE_ERRORS: Record<SpareError, string> = {
  bad_size: "Pick a shirt size.",
  bad_quantity: "Enter how many spares, from 1 to 500.",
  note_too_long: "Keep the note to 200 characters.",
};

export function parseSpare(input: {
  size: string;
  quantity: string;
  note: string;
}): Result<
  { size: ShirtSize; quantity: number; note: string | null },
  SpareError
> {
  if (!isOneOf(SHIRT_SIZES, input.size)) return err("bad_size");
  const raw = input.quantity.trim();
  const quantity = /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
  if (quantity < 1 || quantity > 500) return err("bad_quantity");
  const note = input.note.trim();
  if (note.length > 200) return err("note_too_long");
  return ok({ size: input.size, quantity, note: note || null });
}

export const MAX_DESIGN_LENGTH = 120;

/** A team's shirt design line; empty clears it. */
export function parseDesign(
  raw: string,
): Result<string | null, "design_too_long"> {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length > MAX_DESIGN_LENGTH) return err("design_too_long");
  return ok(text || null);
}
