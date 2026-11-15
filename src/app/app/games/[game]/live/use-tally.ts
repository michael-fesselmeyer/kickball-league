"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseTally, type Tally, tallyKey } from "@/domain/scores/tally";

/**
 * The half's count, kept on this phone so a locked screen, a reload or a
 * moment without signal doesn't lose a run. When the browser won't keep it
 * (private browsing with storage blocked), it lasts as long as the page.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab on the same phone counting the same game.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The stored count for a game, and a setter; the server renders none. */
export function useTally(gameId: string) {
  const key = tallyKey(gameId);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const set = useCallback(
    (tally: Tally | null) =>
      write(key, tally === null ? null : JSON.stringify(tally)),
    [key],
  );
  return [parseTally(raw), set] as const;
}
