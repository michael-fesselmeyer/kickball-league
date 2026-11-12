import { seededRandom } from "../random";
import { err, ok, type Result } from "../result";
import { measure, type Metrics } from "./measure";
import { localSearch, type SearchOptions } from "./search";
import type { Schedule, ScheduledGame, SchedulerInput } from "./types";
import { validate, type Violation } from "./validate";

/** One change an admin makes by hand (scheduling-algorithm.md, section 6). */
export type Edit =
  /** Move a game to an empty slot. Pinned there unless `pin` is false. */
  | { kind: "move"; gameKey: string; slotId: string; pin?: boolean }
  /** Two games trade slots. Both are pinned unless `pin` is false. */
  | { kind: "swap"; gameKeys: [string, string]; pin?: boolean }
  | { kind: "pin"; gameKey: string }
  | { kind: "unpin"; gameKey: string }
  /** Every game on one date trades places with the same field and time on the other. */
  | { kind: "swapDates"; dates: [string, string] };

export type EditError = {
  code:
    | "unknown_game"
    | "unknown_slot"
    | "slot_taken"
    | "not_placed"
    | "same_date"
    | "no_matching_slot";
  message: string;
};

export type EditResult = {
  schedule: Schedule;
  /** The pins after the edit; save these with the schedule. */
  locked: SchedulerInput["locked"];
  violations: Violation[];
  metrics: Metrics;
  metricsBefore: Metrics;
};

/**
 * Applies one manual edit to a copy of the schedule and reports its effect,
 * so the screen can show violations and before-and-after metrics before the
 * admin saves. Violations do not block the edit: a two-step change may be
 * briefly invalid in a draft. A pinned game that moves keeps its pin.
 */
export function applyEdit(
  input: SchedulerInput,
  schedule: Schedule,
  edit: Edit,
): Result<EditResult, EditError> {
  const games = new Map(schedule.games.map((g) => [g.key, g]));
  const slots = new Map(input.slots.map((s) => [s.id, s]));
  const locks = new Map(input.locked.map((l) => [l.gameKey, l.slotId]));
  const moves = new Map<string, string | null>();

  const game = (key: string): Result<ScheduledGame, EditError> => {
    const found = games.get(key);
    return found
      ? ok(found)
      : err({ code: "unknown_game", message: `There is no game ${key}.` });
  };

  switch (edit.kind) {
    case "move": {
      const found = game(edit.gameKey);
      if (!found.ok) return found;
      if (!slots.has(edit.slotId))
        return err({
          code: "unknown_slot",
          message: `There is no slot ${edit.slotId}.`,
        });
      const taken = schedule.games.find(
        (g) => g.slotId === edit.slotId && g.key !== edit.gameKey,
      );
      if (taken)
        return err({
          code: "slot_taken",
          message: `Slot ${edit.slotId} already holds ${taken.key}; swap the two games instead.`,
        });
      moves.set(edit.gameKey, edit.slotId);
      if (edit.pin !== false) locks.set(edit.gameKey, edit.slotId);
      break;
    }
    case "swap": {
      const [a, b] = edit.gameKeys.map(game) as [
        Result<ScheduledGame, EditError>,
        Result<ScheduledGame, EditError>,
      ];
      if (!a.ok) return a;
      if (!b.ok) return b;
      moves.set(a.value.key, b.value.slotId);
      moves.set(b.value.key, a.value.slotId);
      if (edit.pin !== false)
        for (const [key, slotId] of moves)
          if (slotId === null) locks.delete(key);
          else locks.set(key, slotId);
      break;
    }
    case "pin": {
      const found = game(edit.gameKey);
      if (!found.ok) return found;
      if (found.value.slotId === null)
        return err({
          code: "not_placed",
          message: `Game ${edit.gameKey} has no slot to pin it to.`,
        });
      locks.set(edit.gameKey, found.value.slotId);
      break;
    }
    case "unpin": {
      const found = game(edit.gameKey);
      if (!found.ok) return found;
      locks.delete(edit.gameKey);
      break;
    }
    case "swapDates": {
      const [first, second] = edit.dates;
      if (first === second)
        return err({
          code: "same_date",
          message: "Choose two different dates to swap.",
        });
      const counterpart = new Map<string, string>();
      for (const [from, to] of [
        [first, second],
        [second, first],
      ] as const) {
        const target = new Map(
          input.slots
            .filter((s) => s.date === to)
            .map((s) => [`${s.fieldId}\u0000${s.timeIndex}`, s.id]),
        );
        for (const s of input.slots.filter((x) => x.date === from)) {
          const match = target.get(`${s.fieldId}\u0000${s.timeIndex}`);
          if (match) counterpart.set(s.id, match);
        }
      }
      for (const g of schedule.games) {
        const slot = g.slotId === null ? undefined : slots.get(g.slotId);
        if (!slot || (slot.date !== first && slot.date !== second)) continue;
        const to = counterpart.get(slot.id);
        if (!to)
          return err({
            code: "no_matching_slot",
            message: `Game ${g.key} is on field ${slot.fieldId} at time slot ${slot.timeIndex + 1} on ${slot.date}, which the other date does not have.`,
          });
        moves.set(g.key, to);
      }
      break;
    }
  }

  // A pinned game that moved keeps its pin, in its new slot.
  for (const [key, slotId] of moves)
    if (locks.has(key)) {
      if (slotId === null) locks.delete(key);
      else locks.set(key, slotId);
    }

  const next: Schedule = {
    ...schedule,
    games: schedule.games.map((g) =>
      moves.has(g.key) ? { ...g, slotId: moves.get(g.key) ?? null } : g,
    ),
  };
  next.unplaced = next.games.filter((g) => g.slotId === null).map((g) => g.key);
  // A note about a game the edit has now placed no longer applies.
  const placed = next.games.filter((g) => g.slotId !== null).map((g) => g.key);
  next.diagnostics = schedule.diagnostics.filter(
    (note) => !placed.some((key) => note.includes(key)),
  );
  const locked = [...locks].map(([gameKey, slotId]) => ({ gameKey, slotId }));
  const after = { ...input, locked };
  return ok({
    schedule: next,
    locked,
    violations: validate(after, next),
    metrics: measure(after, next),
    metricsBefore: measure(input, schedule),
  });
}

/**
 * "Re-optimize around my changes": Stage C2 again, with the admin's pins
 * held in place. Hard violations already in the schedule are not repaired.
 */
export function reoptimize(
  input: SchedulerInput,
  schedule: Schedule,
  options: SearchOptions = {},
): { schedule: Schedule; violations: Violation[]; metrics: Metrics } {
  const next = localSearch(schedule, input, seededRandom(input.seed), options);
  return {
    schedule: next,
    violations: validate(input, next),
    metrics: measure(input, next),
  };
}
