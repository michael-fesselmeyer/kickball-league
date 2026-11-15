import { applyEdit, type EditError } from "@/domain/scheduler/edits";
import { measure, type Metrics } from "@/domain/scheduler/measure";
import type {
  Schedule,
  SchedulerInput,
  SlotKind,
} from "@/domain/scheduler/types";
import { validate, type Violation } from "@/domain/scheduler/validate";
import { err, ok, type Result } from "@/domain/result";

/**
 * The schedule board's model: what the board shows and what a drop would
 * change. It reuses the scheduler's own `applyEdit`, `validate` and
 * `measure`, so the live preview and the saved draft cannot disagree.
 */

/** A move to an empty slot, or a swap with the game in the target slot. */
export type BoardEdit =
  | { kind: "move"; gameKey: string; slotId: string }
  | { kind: "swap"; gameKeys: [string, string] };

/** A schedule with its hard-rule problems and fairness metrics. */
export type BoardState = {
  input: SchedulerInput;
  schedule: Schedule;
  violations: Violation[];
  metrics: Metrics;
};

/** One slot as the board draws it. */
export type BoardSlot = {
  id: string;
  date: string;
  timeIndex: number;
  fieldId: string;
  day: string;
  time: string;
  field: string;
  kind: SlotKind;
  cancelled: boolean;
};

export type BoardRow = {
  key: string;
  date: string;
  day: string;
  time: string;
  /** One entry per field, in the order of `BoardGrid.fields`. */
  cells: (BoardSlot | null)[];
};

export type BoardGrid = {
  fields: { id: string; label: string }[];
  rows: BoardRow[];
};

export function stateOf(input: SchedulerInput, schedule: Schedule): BoardState {
  return {
    input,
    schedule,
    violations: validate(input, schedule),
    metrics: measure(input, schedule),
  };
}

/** Applies one edit; the moved games are pinned when `pin` is true. */
export function step(
  state: BoardState,
  edit: BoardEdit,
  pin: boolean,
): Result<BoardState, EditError> {
  const result = applyEdit(state.input, state.schedule, { ...edit, pin });
  if (!result.ok) return result;
  const { schedule, locked, violations, metrics } = result.value;
  return ok({
    input: { ...state.input, locked },
    schedule,
    violations,
    metrics,
  });
}

/** Applies the edits in order, stopping at the first that fails. */
export function applyAll(
  state: BoardState,
  edits: readonly BoardEdit[],
  pin: boolean,
): Result<BoardState, EditError> {
  let current = state;
  for (const edit of edits) {
    const next = step(current, edit, pin);
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(current);
}

/**
 * The edit for dropping a game on a slot: a swap when another game holds
 * it, a move when it is empty, and nothing when the game is already there.
 */
export function editFor(
  schedule: Schedule,
  gameKey: string,
  slotId: string,
): Result<BoardEdit | null, EditError> {
  const game = schedule.games.find((g) => g.key === gameKey);
  if (!game)
    return err({
      code: "unknown_game",
      message: `There is no game ${gameKey}.`,
    });
  if (game.slotId === slotId) return ok(null);
  const occupant = schedule.games.find((g) => g.slotId === slotId);
  return ok(
    occupant
      ? { kind: "swap", gameKeys: [gameKey, occupant.key] }
      : { kind: "move", gameKey, slotId },
  );
}

const violationId = (v: Violation) => `${v.rule}\u0000${v.message}`;

/** Problems an edit adds and problems it fixes. */
export function compareViolations(
  before: readonly Violation[],
  after: readonly Violation[],
): { added: Violation[]; fixed: Violation[] } {
  const was = new Set(before.map(violationId));
  const is = new Set(after.map(violationId));
  return {
    added: after.filter((v) => !was.has(violationId(v))),
    fixed: before.filter((v) => !is.has(violationId(v))),
  };
}

/** Game keys in any of the violations, so the board can flag their cards. */
export function gamesInViolation(violations: readonly Violation[]) {
  return new Set(violations.flatMap((v) => v.gameKeys));
}

/**
 * Lays the slots out as the board draws them: one row per date and time,
 * one column per field. Playoff slots are left out, like the metrics.
 */
export function boardGrid(slots: readonly BoardSlot[]): BoardGrid {
  const season = slots.filter((s) => s.kind !== "playoff");
  const fields = [...new Map(season.map((s) => [s.fieldId, s.field])).entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const column = new Map(fields.map((f, i) => [f.id, i]));

  const rows = new Map<string, BoardRow>();
  for (const slot of [...season].sort(
    (a, b) => a.date.localeCompare(b.date) || a.timeIndex - b.timeIndex,
  )) {
    const key = `${slot.date}#${slot.timeIndex}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        date: slot.date,
        day: slot.day,
        time: slot.time,
        cells: fields.map(() => null),
      };
      rows.set(key, row);
    }
    row.cells[column.get(slot.fieldId)!] = slot;
  }
  return { fields, rows: [...rows.values()] };
}

/** Where a slot is, in words: "Sat, Apr 3, 6:00 PM, Field 1". */
export const placeOf = (slot: BoardSlot) =>
  `${slot.day}, ${slot.time}, ${slot.field}`;
