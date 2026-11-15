"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useFormStatus } from "react-dom";
import type { Schedule, SchedulerInput } from "@/domain/scheduler/types";
import type { Violation } from "@/domain/scheduler/validate";
import {
  applyAll,
  boardGrid,
  compareViolations,
  editFor,
  gamesInViolation,
  placeOf,
  stateOf,
  step,
  type BoardEdit,
  type BoardSlot,
  type BoardState,
} from "./board-model";
import { metricRows, readable } from "./labels";

export type BoardProps = {
  versionNo: number;
  input: SchedulerInput;
  schedule: Schedule;
  slots: BoardSlot[];
  /** Team names by id. */
  teams: Record<string, string>;
  /** Saves the edits as a new draft (a bound server action). */
  save: (form: FormData) => Promise<void>;
};

/** Pixels the pointer travels before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

const STATUS_STYLE = {
  good: "text-success",
  review: "text-warning",
  poor: "text-danger",
} as const;

type Drag = {
  gameKey: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The drag-and-drop schedule board (design-system.md, "Schedule board").
 * Drag a game onto an empty slot to move it, or onto another game to swap
 * the two. While a game is held, the panel shows what dropping it on the
 * slot under the pointer would do: new hard-rule problems and the change in
 * each fairness metric, from the scheduler's own checks.
 *
 * Keyboard: the board is one tab stop; arrow keys move between slots, Enter
 * or Space picks up the focused game and drops it on the focused slot,
 * Escape puts it back. Clicking works the same way. Edits stay on the board
 * until they are saved together as one new draft.
 */
export function Board({
  versionNo,
  input,
  schedule,
  slots,
  teams,
  save,
}: BoardProps) {
  const names = useMemo(() => new Map(Object.entries(teams)), [teams]);
  const grid = useMemo(() => boardGrid(slots), [slots]);
  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  const saved = useMemo(() => stateOf(input, schedule), [input, schedule]);

  const [edits, setEdits] = useState<BoardEdit[]>([]);
  const [pin, setPin] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [focusAt, setFocusAt] = useState<[number, number]>(() => {
    for (const [r, row] of grid.rows.entries()) {
      const c = row.cells.findIndex(Boolean);
      if (c >= 0) return [r, c];
    }
    return [0, 0];
  });
  const [announcement, setAnnouncement] = useState("");

  const drag = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  const ghost = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  /** A slot whose cell should take focus after the next render. */
  const refocus = useRef<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const instructions = useId();

  const staged = useMemo(() => {
    const result = applyAll(saved, edits, pin);
    return result.ok ? result.value : saved;
  }, [saved, edits, pin]);

  const gameBySlot = useMemo(
    () =>
      new Map(
        staged.schedule.games
          .filter((g) => g.slotId !== null)
          .map((g) => [g.slotId!, g]),
      ),
    [staged],
  );
  const gameByKey = useMemo(
    () => new Map(staged.schedule.games.map((g) => [g.key, g])),
    [staged],
  );
  const pinned = useMemo(
    () => new Set(staged.input.locked.map((l) => l.gameKey)),
    [staged],
  );
  const flagged = useMemo(() => gamesInViolation(staged.violations), [staged]);
  const changed = useMemo(() => {
    const before = new Map(saved.schedule.games.map((g) => [g.key, g.slotId]));
    return new Set(
      staged.schedule.games
        .filter((g) => before.get(g.key) !== g.slotId)
        .map((g) => g.key),
    );
  }, [saved, staged]);

  const title = useCallback(
    (key: string) => {
      const game = gameByKey.get(key);
      if (!game) return key;
      return `${names.get(game.teamA) ?? game.teamA} vs ${names.get(game.teamB) ?? game.teamB}`;
    },
    [gameByKey, names],
  );

  /** What dropping the held game on the target would do. */
  const preview = useMemo(() => {
    if (!picked || !target) return null;
    const edit = editFor(staged.schedule, picked, target);
    if (!edit.ok || !edit.value) return null;
    const next = step(staged, edit.value, pin);
    return next.ok ? { edit: edit.value, state: next.value } : null;
  }, [picked, target, staged, pin]);

  const describeTarget = useCallback(
    (slotId: string) => {
      const slot = slotById.get(slotId);
      const occupant = gameBySlot.get(slotId);
      const where = slot ? placeOf(slot) : slotId;
      return occupant && occupant.key !== picked
        ? `swap with ${title(occupant.key)} at ${where}`
        : `move to ${where}`;
    },
    [slotById, gameBySlot, picked, title],
  );

  const summarize = useCallback((before: BoardState, after: BoardState) => {
    const { added, fixed } = compareViolations(
      before.violations,
      after.violations,
    );
    const parts = [
      added.length === 0
        ? "no new problems"
        : `${plural(added.length, "new problem")}`,
    ];
    if (fixed.length > 0) parts.push(`fixes ${fixed.length}`);
    const rowsBefore = metricRows(before.metrics);
    metricRows(after.metrics).forEach((row, i) => {
      const was = rowsBefore[i]!.metric.value;
      if (row.metric.value !== was)
        parts.push(`${row.label} ${was} to ${row.metric.value}`);
    });
    return parts.join("; ");
  }, []);

  const aim = useCallback(
    (slotId: string | null) => {
      setTarget(slotId);
      if (!picked || !slotId) return;
      const edit = editFor(staged.schedule, picked, slotId);
      if (!edit.ok || !edit.value) {
        setAnnouncement(`${title(picked)} is already here.`);
        return;
      }
      const next = step(staged, edit.value, pin);
      if (next.ok)
        setAnnouncement(
          `${describeTarget(slotId)}: ${summarize(staged, next.value)}.`,
        );
    },
    [picked, staged, pin, title, describeTarget, summarize],
  );

  const cancel = useCallback(() => {
    if (picked) setAnnouncement(`Put back ${title(picked)}.`);
    setPicked(null);
    setTarget(null);
    setDragging(false);
  }, [picked, title]);

  const drop = useCallback(
    (gameKey: string, slotId: string) => {
      setPicked(null);
      setTarget(null);
      setDragging(false);
      const slot = slotById.get(slotId);
      if (!slot || slot.cancelled) {
        setAnnouncement("That slot is cancelled.");
        return;
      }
      const edit = editFor(staged.schedule, gameKey, slotId);
      if (!edit.ok || !edit.value) {
        setAnnouncement(`Put back ${title(gameKey)}.`);
        return;
      }
      const next = step(staged, edit.value, pin);
      if (!next.ok) {
        setAnnouncement(next.error.message);
        return;
      }
      setEdits((list) => [...list, edit.value!]);
      refocus.current = slotId;
      setAnnouncement(
        `${title(gameKey)}: ${describeTarget(slotId)}. ${plural(next.value.violations.length, "problem")} on the board now.`,
      );
    },
    [slotById, staged, pin, title, describeTarget],
  );

  const pick = useCallback(
    (gameKey: string) => {
      setPicked(gameKey);
      setTarget(null);
      setAnnouncement(
        `Picked up ${title(gameKey)}. Choose a slot and press Enter, or Escape to put it back.`,
      );
    },
    [title],
  );

  /** A click or Enter on a cell: pick up, drop, swap or put back. */
  const activate = (slotId: string | null, gameKey: string | null) => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    if (picked) {
      if (gameKey === picked) cancel();
      else if (slotId) drop(picked, slotId);
      return;
    }
    if (gameKey) pick(gameKey);
  };

  // Pointer dragging: press on a game, move past the threshold, release on a slot.
  const onPointerDown = (e: PointerEvent<HTMLElement>, gameKey: string) => {
    justDragged.current = false;
    if (e.button !== 0) return;
    drag.current = {
      gameKey,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  };

  const placeGhost = (el: HTMLElement) => {
    const { x, y } = pointer.current;
    el.style.transform = `translate3d(${x + 12}px, ${y + 12}px, 0)`;
  };

  const slotUnder = (x: number, y: number) => {
    const cell = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-slot]");
    return cell?.dataset.slot ?? null;
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    if (!current.active) {
      const distance = Math.hypot(
        e.clientX - current.startX,
        e.clientY - current.startY,
      );
      if (distance < DRAG_THRESHOLD) return;
      current.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setPicked(current.gameKey);
      setDragging(true);
    }
    pointer.current = { x: e.clientX, y: e.clientY };
    if (ghost.current) placeGhost(ghost.current);
    const slotId = slotUnder(e.clientX, e.clientY);
    if (slotId !== target) aim(slotId);
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current?.active || current.pointerId !== e.pointerId) return;
    justDragged.current = true;
    const slotId = slotUnder(e.clientX, e.clientY);
    if (slotId) drop(current.gameKey, slotId);
    else cancel();
  };

  const onPointerCancel = () => {
    if (drag.current?.active) cancel();
    drag.current = null;
  };

  /**
   * Focuses the cell at (row, col), or, when that spot has no slot, the next
   * one in the direction of travel. Returns false at the edge of the board.
   */
  const focusCell = (row: number, col: number, dr = 0, dc = 0) => {
    let [r, c] = [row, col];
    while (r >= 0 && r < grid.rows.length && c >= 0 && c < grid.fields.length) {
      if (grid.rows[r]!.cells[c]) {
        setFocusAt([r, c]);
        table.current
          ?.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`)
          ?.focus();
        return true;
      }
      if (dr === 0 && dc === 0) return false;
      r += dr;
      c += dc;
    }
    return false;
  };

  const cellOf = (slotId: string): [number, number] | null => {
    for (const [r, row] of grid.rows.entries()) {
      const c = row.cells.findIndex((s) => s?.id === slotId);
      if (c >= 0) return [r, c];
    }
    return null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Enter activates here rather than through the button's own click, so
    // it behaves the same whatever sends the key.
    if (e.key === "Enter" && !e.repeat) {
      e.preventDefault();
      e.currentTarget.click();
      return;
    }
    if (e.key === "Escape" && picked) {
      e.preventDefault();
      // Focus first, so the put-back message is the one announced.
      const from = gameByKey.get(picked)?.slotId;
      const at = from ? cellOf(from) : null;
      if (at) focusCell(at[0], at[1]);
      cancel();
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = moves[e.key];
    if (!delta) {
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const last = grid.rows.length - 1;
        if (e.key === "Home") focusCell(0, focusAt[1], 1, 0);
        else focusCell(last, focusAt[1], -1, 0);
      }
      return;
    }
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!cell) return;
    e.preventDefault();
    focusCell(
      Number(cell.dataset.row) + delta[0],
      Number(cell.dataset.col) + delta[1],
      delta[0],
      delta[1],
    );
  };

  // A drop swaps an empty slot's button for a game's, which loses focus;
  // give it to the cell where the game landed.
  useEffect(() => {
    const slotId = refocus.current;
    refocus.current = null;
    const at = slotId ? cellOf(slotId) : null;
    if (at) focusCell(at[0], at[1]);
  });

  // Escape also drops a pointer drag, wherever the focus is.
  useEffect(() => {
    if (!dragging) return;
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      drag.current = null;
      justDragged.current = true;
      cancel();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [dragging, cancel]);

  const unplaced = staged.schedule.games.filter((g) => g.slotId === null);
  const after = preview?.state ?? null;
  const effect = after
    ? { before: staged, after, heading: `If you drop ${title(picked!)} here` }
    : { before: saved, after: staged, heading: "Unsaved changes" };

  const gameLabel = (key: string) => {
    const game = gameByKey.get(key)!;
    const notes = [`round ${game.round}`];
    if (pinned.has(key)) notes.push("pinned");
    if (changed.has(key)) notes.push("moved, not saved");
    if (flagged.has(key)) notes.push("breaks a hard rule");
    return notes.join(", ");
  };

  return (
    <section
      aria-labelledby="board"
      className={`flex flex-col gap-3 ${dragging ? "cursor-grabbing select-none" : ""}`}
    >
      <h3 id="board" className="text-h3">
        Board
      </h3>
      <p id={instructions} className="max-w-prose text-text-muted">
        Drag a game to an empty slot to move it, or onto another game to swap
        them. With a keyboard, use the arrow keys to move between slots, Enter
        to pick up a game and Enter again to drop it; Escape puts it back.
        Changes stay here until you save them as a new draft.
      </p>

      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {unplaced.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-warning p-3">
              <h4 className="font-bold">Not placed</h4>
              <ul className="flex flex-wrap gap-2">
                {unplaced.map((g) => (
                  <li key={g.key}>
                    <GameButton
                      label={title(g.key)}
                      detail={gameLabel(g.key)}
                      held={picked === g.key}
                      flagged={flagged.has(g.key)}
                      changed={changed.has(g.key)}
                      pinned={pinned.has(g.key)}
                      onKeyDown={onKeyDown}
                      onClick={() => activate(null, g.key)}
                      onPointerDown={(e) => onPointerDown(e, g.key)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerCancel}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table
              ref={table}
              aria-describedby={instructions}
              className="w-full table-fixed border-collapse text-left text-small"
            >
              <caption className="sr-only">
                Schedule board for version {versionNo}: times down the side,
                fields across the top
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-36 p-1 text-text-muted">
                    When
                  </th>
                  {grid.fields.map((f) => (
                    <th key={f.id} scope="col" className="p-1">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row, r) => {
                  const newDay = r === 0 || grid.rows[r - 1]!.date !== row.date;
                  return (
                    <tr
                      key={row.key}
                      className={
                        newDay ? "border-t-2 border-border-strong" : ""
                      }
                    >
                      <th scope="row" className="p-1 align-top font-normal">
                        <span className="font-bold">{row.day}</span>
                        <br />
                        {row.time}
                      </th>
                      {row.cells.map((slot, c) => {
                        const tabbable = focusAt[0] === r && focusAt[1] === c;
                        if (!slot)
                          return (
                            <td key={c} className="p-1">
                              <span className="sr-only">No slot</span>
                            </td>
                          );
                        const game = gameBySlot.get(slot.id);
                        const aimed = picked !== null && target === slot.id;
                        const verdict =
                          aimed && preview
                            ? compareViolations(
                                staged.violations,
                                preview.state.violations,
                              ).added.length
                            : null;
                        return (
                          <td
                            key={slot.id}
                            data-slot={slot.cancelled ? undefined : slot.id}
                            className="p-1 align-top"
                            onPointerEnter={() => {
                              if (picked && !dragging) aim(slot.id);
                            }}
                          >
                            <div
                              className={`relative rounded-md ${
                                aimed
                                  ? verdict
                                    ? "outline-2 outline-offset-1 outline-danger outline-dashed"
                                    : "outline-2 outline-offset-1 outline-success"
                                  : ""
                              }`}
                            >
                              {game ? (
                                <GameButton
                                  label={title(game.key)}
                                  detail={`${gameLabel(game.key)}; ${placeOf(slot)}`}
                                  held={picked === game.key}
                                  flagged={flagged.has(game.key)}
                                  changed={changed.has(game.key)}
                                  pinned={pinned.has(game.key)}
                                  swapTarget={
                                    picked !== null && picked !== game.key
                                  }
                                  tabIndex={tabbable ? 0 : -1}
                                  row={r}
                                  col={c}
                                  onFocus={() => {
                                    setFocusAt([r, c]);
                                    if (picked && !dragging) aim(slot.id);
                                  }}
                                  onKeyDown={onKeyDown}
                                  onClick={() => activate(slot.id, game.key)}
                                  onPointerDown={(e) =>
                                    onPointerDown(e, game.key)
                                  }
                                  onPointerMove={onPointerMove}
                                  onPointerUp={onPointerUp}
                                  onPointerCancel={onPointerCancel}
                                />
                              ) : (
                                <button
                                  type="button"
                                  data-row={r}
                                  data-col={c}
                                  tabIndex={tabbable ? 0 : -1}
                                  aria-disabled={!picked || slot.cancelled}
                                  onKeyDown={onKeyDown}
                                  onFocus={() => {
                                    setFocusAt([r, c]);
                                    if (picked && !dragging) aim(slot.id);
                                  }}
                                  onClick={() => {
                                    if (picked && !slot.cancelled)
                                      activate(slot.id, null);
                                  }}
                                  className={`flex min-h-14 w-full items-center justify-center rounded-md border border-dashed px-2 text-text-muted ${
                                    slot.cancelled
                                      ? "border-danger"
                                      : "border-border-strong"
                                  }`}
                                >
                                  {slot.cancelled
                                    ? "Cancelled"
                                    : picked
                                      ? "Move here"
                                      : slot.kind === "makeup_reserve"
                                        ? "Open (makeup)"
                                        : "Open"}
                                  <span className="sr-only">
                                    : {placeOf(slot)}
                                  </span>
                                </button>
                              )}
                              {aimed && verdict !== null && (
                                <p
                                  aria-hidden="true"
                                  className={`pointer-events-none absolute -top-2 right-1 rounded-full border bg-surface px-2 text-micro font-bold ${verdict ? "border-danger text-danger" : "border-success text-success"}`}
                                >
                                  {verdict
                                    ? `+${plural(verdict, "problem")}`
                                    : "No new problems"}
                                </p>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside
          aria-label="Effect of your changes"
          className="sticky top-4 flex w-72 shrink-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <Effect {...effect} names={names} />

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="font-bold">
              {edits.length === 0
                ? "No unsaved changes"
                : `${plural(edits.length, "unsaved change")}`}
            </p>
            {edits.length > 0 && (
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-small">
                {edits.map((edit, i) => (
                  <li key={i}>
                    {edit.kind === "move"
                      ? `Moved ${title(edit.gameKey)} to ${
                          slotById.get(edit.slotId)
                            ? placeOf(slotById.get(edit.slotId)!)
                            : edit.slotId
                        }`
                      : `Swapped ${title(edit.gameKeys[0])} with ${title(edit.gameKeys[1])}`}
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={edits.length === 0}
                onClick={() => {
                  setEdits((list) => list.slice(0, -1));
                  setAnnouncement("Undid the last change.");
                }}
              >
                Undo
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={edits.length === 0}
                onClick={() => {
                  setEdits([]);
                  setAnnouncement("Discarded all unsaved changes.");
                }}
              >
                Discard
              </button>
            </div>
            <form action={save} className="flex flex-col gap-2">
              <input type="hidden" name="edits" value={JSON.stringify(edits)} />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="pin"
                  checked={pin}
                  onChange={(e) => setPin(e.target.checked)}
                />
                Pin moved games, so regenerating keeps them
              </label>
              <SaveButton count={edits.length} />
            </form>
          </div>
        </aside>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
      {dragging && picked && (
        <div
          ref={(el) => {
            ghost.current = el;
            if (el) placeGhost(el);
          }}
          aria-hidden="true"
          className="pointer-events-none fixed top-0 left-0 z-50 rounded-md border-2 border-text bg-highlight px-2 py-1 font-bold text-on-highlight shadow-sticker"
        >
          {title(picked)}
        </div>
      )}
    </section>
  );
}

type GameButtonProps = {
  label: string;
  detail: string;
  held: boolean;
  flagged: boolean;
  changed: boolean;
  pinned: boolean;
  swapTarget?: boolean;
  tabIndex?: number;
  row?: number;
  col?: number;
  onFocus?: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onClick: () => void;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
};

function GameButton({
  label,
  detail,
  held,
  flagged,
  changed,
  pinned,
  swapTarget,
  row,
  col,
  ...handlers
}: GameButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={held}
      data-row={row}
      data-col={col}
      className={`flex min-h-14 w-full cursor-grab flex-col items-start rounded-md border-2 px-2 py-1 text-left ${
        held
          ? "border-text bg-highlight text-on-highlight"
          : flagged
            ? "border-danger bg-surface"
            : changed
              ? "border-brand bg-surface"
              : "border-border bg-surface"
      }`}
      {...handlers}
    >
      <span className="font-bold">
        {swapTarget && <span className="sr-only">Swap with </span>}
        {label}
      </span>
      <span className="text-micro">
        {[pinned && "Pinned", changed && "Moved", flagged && "Problem"]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <span className="sr-only">: {detail}</span>
    </button>
  );
}

function Effect({
  before,
  after,
  heading,
  names,
}: {
  before: BoardState;
  after: BoardState;
  heading: string;
  names: ReadonlyMap<string, string>;
}) {
  const { added, fixed } = compareViolations(
    before.violations,
    after.violations,
  );
  const rowsBefore = metricRows(before.metrics);
  const list = (items: Violation[], style: string) => (
    <ul className={`flex list-disc flex-col gap-1 pl-5 text-small ${style}`}>
      {items.map((v) => (
        <li key={`${v.rule}:${v.message}`}>
          {v.rule}: {readable(v.message, names)}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-bold">{heading}</h4>
      <p className={added.length > 0 ? "text-danger" : "text-success"}>
        {added.length === 0
          ? "No new hard-rule problems."
          : `${plural(added.length, "new hard-rule problem")}:`}
      </p>
      {added.length > 0 && list(added, "text-danger")}
      {fixed.length > 0 && (
        <>
          <p className="text-success">
            Fixes {plural(fixed.length, "problem")}:
          </p>
          {list(fixed, "")}
        </>
      )}
      <dl className="flex flex-col text-small">
        {metricRows(after.metrics).map((row, i) => {
          const was = rowsBefore[i]!.metric.value;
          const moved = row.metric.value !== was;
          return (
            <div
              key={row.label}
              className="flex justify-between gap-2 border-b border-border py-1"
            >
              <dt className={moved ? "font-bold" : ""}>{row.label}</dt>
              <dd className={STATUS_STYLE[row.metric.status]}>
                {moved && (
                  <>
                    <span className="text-text-muted">{was}</span>
                    <span aria-hidden="true"> → </span>
                    <span className="sr-only"> to </span>
                  </>
                )}
                <span className={moved ? "font-bold" : ""}>
                  {row.metric.value}
                </span>
                <span className="sr-only"> ({row.metric.status})</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function SaveButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn self-start btn-primary"
      disabled={count === 0 || pending}
    >
      {pending
        ? "Saving…"
        : count === 0
          ? "Save as a new draft"
          : `Save ${plural(count, "change")} as a new draft`}
    </button>
  );
}
