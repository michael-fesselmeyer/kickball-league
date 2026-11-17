"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the ref has asked to end a game and is looking at the "Game
 * over?" question. Kept outside the component, for the page's lifetime, so
 * a save landing just after the tap (each one re-renders the page from the
 * server) can't take the question away and leave the ref tapping "End the
 * game" again. A reload starts with the question closed.
 */
const asking = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a game's end is being confirmed, and a setter; the server renders no question. */
export function useEndConfirm(gameId: string) {
  const confirming = useSyncExternalStore(
    subscribe,
    () => asking.has(gameId),
    () => false,
  );
  const setConfirming = useCallback(
    (value: boolean) => {
      if (value) asking.add(gameId);
      else asking.delete(gameId);
      for (const listener of listeners) listener();
    },
    [gameId],
  );
  return [confirming, setConfirming] as const;
}
