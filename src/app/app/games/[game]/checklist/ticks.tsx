"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

/**
 * A team's game-day checklist, ticked by its captains (issue #409). A tick
 * is sent at once; with no signal it waits on the phone and goes out when
 * the signal is back, so the list works at a field without coverage, like
 * the rest of the saved game.
 */

type Item = { id: string; text: string };
type Pending = {
  userId: string;
  gameId: string;
  teamSeasonId: string;
  itemId: string;
  on: boolean;
};

const KEY = "kb-checklist-ticks";
const CHANGED = "kb-checklist-ticks";

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): Pending[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as Pending[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: Pending[]) {
  try {
    if (queue.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Storage full or blocked: the tick still goes out if there is signal.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const same = (a: Pending, b: Pending) =>
  a.gameId === b.gameId &&
  a.teamSeasonId === b.teamSeasonId &&
  a.itemId === b.itemId;

/**
 * Sends this person's waiting ticks, telling `onSaved` about each one the
 * server kept; keeps the ones that can't go yet. Returns the last refusal.
 */
async function sendQueued(
  userId: string,
  onSaved: (entry: Pending) => void,
): Promise<string | null> {
  let problem: string | null = null;
  for (const entry of parse(readRaw()).filter((e) => e.userId === userId)) {
    let response: Response;
    try {
      response = await fetch(`/api/games/${entry.gameId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSeasonId: entry.teamSeasonId,
          itemId: entry.itemId,
          on: entry.on,
        }),
      });
    } catch {
      return problem; // Still no signal: try again when it's back.
    }
    if (response.status === 401 || response.status === 423) return problem;
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
    } | null;
    if (body?.ok) onSaved(entry);
    else if (body?.message) problem = body.message;
    // Done with it either way: saved, or refused for good. A newer tap on
    // the same item stays queued.
    writeQueue(
      parse(readRaw()).filter((e) => !(same(e, entry) && e.on === entry.on)),
    );
  }
  return problem;
}

export function ChecklistTicks({
  userId,
  gameId,
  teamSeasonId,
  teamName,
  phases,
  ticked,
}: {
  userId: string;
  gameId: string;
  teamSeasonId: string;
  teamName: string;
  phases: { label: string; items: Item[] }[];
  ticked: string[];
}) {
  // What the server has, as far as this page knows.
  const [saved, setSaved] = useState(() => new Set(ticked));
  const [problem, setProblem] = useState<string | null>(null);
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const waiting = useMemo(
    () =>
      parse(raw).filter(
        (e) =>
          e.userId === userId &&
          e.gameId === gameId &&
          e.teamSeasonId === teamSeasonId,
      ),
    [raw, userId, gameId, teamSeasonId],
  );
  // Ticks still waiting on this phone show as made.
  const on = useMemo(() => {
    const shown = new Set(saved);
    for (const e of waiting) {
      if (e.on) shown.add(e.itemId);
      else shown.delete(e.itemId);
    }
    return shown;
  }, [saved, waiting]);

  const send = useCallback(async () => {
    const message = await sendQueued(userId, (entry) => {
      if (entry.gameId !== gameId || entry.teamSeasonId !== teamSeasonId)
        return;
      setSaved((prev) => {
        const next = new Set(prev);
        if (entry.on) next.add(entry.itemId);
        else next.delete(entry.itemId);
        return next;
      });
    });
    if (message) setProblem(message);
  }, [userId, gameId, teamSeasonId]);

  useEffect(() => {
    // Ticks left on this phone earlier go out once the page is up.
    const first = setTimeout(() => void send(), 0);
    const online = () => void send();
    window.addEventListener("online", online);
    return () => {
      clearTimeout(first);
      window.removeEventListener("online", online);
    };
  }, [send]);

  function toggle(itemId: string, value: boolean) {
    setProblem(null);
    const entry = { userId, gameId, teamSeasonId, itemId, on: value };
    writeQueue([...parse(readRaw()).filter((e) => !same(e, entry)), entry]);
    void send();
  }

  return (
    <section
      aria-labelledby={`ticks-${teamSeasonId}`}
      className="flex flex-col gap-3"
    >
      <h2 id={`ticks-${teamSeasonId}`} className="text-h2">
        {teamName}
      </h2>
      {phases.map((phase) => (
        <fieldset key={phase.label} className="flex flex-col gap-1">
          <legend className="text-h3">{phase.label}</legend>
          {phase.items.map((item) => (
            <label
              key={item.id}
              className="flex min-h-11 items-center gap-3 border-t border-border py-2"
            >
              <input
                type="checkbox"
                className="size-6"
                checked={on.has(item.id)}
                onChange={(e) => toggle(item.id, e.currentTarget.checked)}
              />
              <span>{item.text}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <p role="status" className="min-h-6 text-small text-text-muted">
        {problem ??
          (waiting.length > 0
            ? `${waiting.length} saved on this phone; they send when you have signal.`
            : "")}
      </p>
    </section>
  );
}
