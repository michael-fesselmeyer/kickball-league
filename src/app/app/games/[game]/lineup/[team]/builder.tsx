"use client";

import { useEffect, useRef, useState } from "react";
import {
  autoArrange,
  explainImpossible,
  explainPickup,
  explainRun,
  type Kicker,
  move,
  ordinal,
  pickupBreaks,
  reconcile,
  runBreaks,
} from "@/domain/lineup/order";

type Props = {
  kickers: Kicker[];
  /** The order to start from, as ids. */
  initial: string[];
  /** The team's order from its last game, as ids, if it saved one. */
  previous: string[] | null;
  /** An order is already saved for this game. */
  saved: boolean;
  save: (form: FormData) => Promise<void>;
};

const SIDE = { woman: "Counts with women", man: "Counts with men" } as const;

type Focus = { id: string; control: "handle" | "up" | "down" };

/**
 * The kicking-order list: drag a row by its handle, pick it up with Space
 * or Enter and move it with the arrow keys, or use the up and down buttons.
 * Rule breaks are checked as the order changes.
 */
export function LineupBuilder({
  kickers,
  initial,
  previous,
  saved,
  save,
}: Props) {
  const byId = new Map(kickers.map((k) => [k.id, k]));
  const [ids, setIds] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<{
    id: string;
    before: string[];
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const order = ids.flatMap((id) => {
    const k = byId.get(id);
    return k ? [k] : [];
  });
  const runs = runBreaks(order);
  const pickups = pickupBreaks(order);
  const inRun = new Set(runs.flatMap((r) => r.positions));
  const changed = ids.join(",") !== initial.join(",");

  // While a row is dragged, follow the pointer anywhere on the page.
  const latest = useRef({ ids, byId });
  useEffect(() => {
    latest.current = { ids, byId };
  });
  useEffect(() => {
    if (dragging === null) return;
    const id = dragging;
    const onMove = (event: PointerEvent) => {
      const rows = [
        ...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []),
      ];
      const to = rows.findIndex((row) => {
        const box = row.getBoundingClientRect();
        return event.clientY >= box.top && event.clientY <= box.bottom;
      });
      if (to === -1) return;
      setIds((current) => {
        const from = current.indexOf(id);
        return from === to ? current : move(current, from, to);
      });
    };
    const onEnd = () => {
      const now = latest.current;
      setAnnouncement(
        `${now.byId.get(id)?.name ?? "A player"} now kicks ${ordinal(now.ids.indexOf(id) + 1)} of ${now.ids.length}.`,
      );
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [dragging]);

  // Moving a row re-inserts it, which drops focus; put focus back.
  useEffect(() => {
    if (!focus || !list.current) return;
    const find = (control: Focus["control"]) =>
      list.current?.querySelector<HTMLButtonElement>(
        `[data-control="${control}"][data-id="${focus.id}"]`,
      );
    const target = find(focus.control);
    (target && !target.disabled ? target : find("handle"))?.focus();
  }, [focus, ids]);

  const nameOf = (id: string) => byId.get(id)?.name ?? "A player";
  const place = (next: string[], id: string) =>
    `${nameOf(id)} now kicks ${ordinal(next.indexOf(id) + 1)} of ${next.length}.`;

  function moveTo(id: string, to: number, control: Focus["control"]) {
    const from = ids.indexOf(id);
    if (from === -1 || to < 0 || to >= ids.length || to === from) return;
    const next = move(ids, from, to);
    setIds(next);
    setAnnouncement(place(next, id));
    setFocus({ id, control });
  }

  function onHandleKey(event: React.KeyboardEvent, id: string) {
    const at = ids.indexOf(id);
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (grabbed?.id === id) {
        setGrabbed(null);
        setAnnouncement(`Dropped. ${place(ids, id)}`);
      } else {
        setGrabbed({ id, before: ids });
        setAnnouncement(
          `Picked up ${nameOf(id)}, ${ordinal(at + 1)} of ${ids.length}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
        );
      }
    } else if (grabbed?.id === id && event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(id, at - 1, "handle");
    } else if (grabbed?.id === id && event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(id, at + 1, "handle");
    } else if (grabbed?.id === id && event.key === "Escape") {
      event.preventDefault();
      setIds(grabbed.before);
      setGrabbed(null);
      setAnnouncement(`Cancelled. ${place(grabbed.before, id)}`);
      setFocus({ id, control: "handle" });
    }
  }

  function arrange() {
    const result = autoArrange(order);
    if (!result.ok) {
      setNotice(explainImpossible(result.error));
      return;
    }
    const next = result.value.map((k) => k.id);
    const moved = next.join(",") !== ids.join(",");
    setIds(next);
    const message = moved
      ? "Arranged so no more than two of a side kick in a row, moving as few people as it could."
      : "This order already keeps to the rule, so nothing moved.";
    setNotice(message);
    setAnnouncement(message);
  }

  function copyLast() {
    if (!previous) return;
    const result = reconcile(previous, kickers);
    setIds(result.order.map((k) => k.id));
    const notes = [
      "Copied the order from your last game.",
      result.dropped.length > 0 &&
        `${result.dropped.length} from that order ${result.dropped.length === 1 ? "isn't" : "aren't"} coming this time.`,
      result.added.length > 0 &&
        `New at the end: ${result.added.map((k) => k.name).join(", ")}.`,
    ].filter((n) => typeof n === "string");
    const message = notes.join(" ");
    setNotice(message);
    setAnnouncement(message);
  }

  const problems = [
    ...runs.map((r) => explainRun(r, order)),
    ...pickups.map((p) => explainPickup(p, order)),
  ];

  return (
    <section aria-labelledby="order-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="order-heading" className="text-h3">
          Kicking order
        </h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={arrange} className="btn btn-secondary">
            Auto-arrange
          </button>
          {previous && (
            <button
              type="button"
              onClick={copyLast}
              className="btn btn-secondary"
            >
              Copy last game
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className="rounded-lg border border-border p-3 text-small">
          {notice}
        </p>
      )}

      <div className="min-h-[3lh]">
        {problems.length === 0 ? (
          <p className="text-small text-success">
            Keeps to the rule: no more than two of a side in a row, counting
            from the last kicker back to the first.
          </p>
        ) : (
          <div className="rounded-lg border border-danger p-3 text-small">
            <p className="font-semibold">
              {problems.length === 1
                ? "One thing breaks the rules:"
                : `${problems.length} things break the rules:`}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <ol
        ref={list}
        className={`flex flex-col gap-1 ${dragging ? "select-none" : ""}`}
      >
        {order.map((k, i) => {
          const breaks = inRun.has(i);
          const lifted = dragging === k.id || grabbed?.id === k.id;
          return (
            <li
              key={k.id}
              data-row
              className={`flex items-center gap-2 rounded-lg border bg-surface px-2 py-1 ${
                breaks ? "border-danger" : "border-border"
              } ${lifted ? "shadow-md ring-2 ring-focus" : ""}`}
            >
              <span className="w-7 text-right text-text-muted tabular-nums">
                {i + 1}
              </span>
              <button
                type="button"
                data-control="handle"
                data-id={k.id}
                aria-label={`Move ${k.name}, ${ordinal(i + 1)} of ${order.length}`}
                aria-pressed={grabbed?.id === k.id}
                aria-describedby="move-help"
                onKeyDown={(e) => onHandleKey(e, k.id)}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setGrabbed(null);
                  setDragging(k.id);
                }}
                className="flex h-11 w-9 cursor-grab touch-none items-center justify-center rounded-md text-text-muted"
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="20"
                  viewBox="0 0 14 20"
                >
                  {[3, 10, 17].flatMap((y) =>
                    [3, 11].map((x) => (
                      <circle
                        key={`${x}-${y}`}
                        cx={x}
                        cy={y}
                        r="1.8"
                        fill="currentColor"
                      />
                    )),
                  )}
                </svg>
              </button>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{k.name}</span>
                <span className="text-small text-text-muted">
                  {k.side ? SIDE[k.side] : "No side chosen"}
                  {k.pickup && " · pickup"}
                  {breaks && (
                    <span className="text-danger"> · three in a row</span>
                  )}
                </span>
              </span>
              <button
                type="button"
                data-control="up"
                data-id={k.id}
                aria-label={`Move ${k.name} up`}
                disabled={i === 0}
                onClick={() => moveTo(k.id, i - 1, "up")}
                className="flex h-11 w-11 items-center justify-center rounded-md border border-border disabled:opacity-40"
              >
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                data-control="down"
                data-id={k.id}
                aria-label={`Move ${k.name} down`}
                disabled={i === order.length - 1}
                onClick={() => moveTo(k.id, i + 1, "down")}
                className="flex h-11 w-11 items-center justify-center rounded-md border border-border disabled:opacity-40"
              >
                <span aria-hidden="true">↓</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p id="move-help" className="text-small text-text-muted">
        Drag a row by its handle, or focus the handle, press Space, move with
        the arrow keys and press Space again.
      </p>

      <form action={save} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="order" value={ids.join(",")} />
        <button type="submit" className="btn btn-primary">
          Save kicking order
        </button>
        <span className="text-small text-text-muted">
          {changed ? "Not saved yet." : saved ? "Saved." : "Not saved yet."}
        </span>
      </form>
    </section>
  );
}
