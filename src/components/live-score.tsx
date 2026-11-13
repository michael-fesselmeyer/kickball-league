"use client";

import { useEffect, useState } from "react";
import { type LiveSnapshot, nextPollIn, POLL_MS } from "@/domain/scores/live";
import { LiveLine } from "./line-score";

/**
 * The live line score on the public game page (ADR 0009). The page renders
 * it with the score at render time; while the game is on and the tab is
 * visible, it asks the live JSON route again every 10 seconds, so a new
 * half-inning shows within 15 seconds without a reload. It stops once the
 * game is final, and when the game is not on it does not poll at all.
 */
export function LiveScore({
  gameId,
  teamA,
  teamB,
  initial,
  pollFrom,
  pollUntil,
}: {
  gameId: string;
  teamA: string;
  teamB: string;
  initial: LiveSnapshot;
  /** ISO times: the game's window, from shortly before it starts. */
  pollFrom: string;
  pollUntil: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);

  useEffect(() => {
    if (initial.closed) return;
    const from = Date.parse(pollFrom);
    const until = Date.parse(pollUntil);
    let lastEntryAt = initial.lastEntryAt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    /** Milliseconds to the next poll, or null when the game is not on. */
    const wait = () =>
      nextPollIn(Date.now(), {
        from,
        until,
        lastEntryAt: lastEntryAt ? Date.parse(lastEntryAt) : null,
      });
    const scheduleNext = () => {
      clearTimeout(timer);
      const ms = wait();
      if (ms !== null) timer = setTimeout(tick, ms);
    };
    async function tick() {
      if (done || document.visibilityState !== "visible") return;
      // Before the window this only waits on; inside it, it asks.
      if (wait() === POLL_MS) {
        try {
          const response = await fetch(`/api/games/${gameId}/live`);
          if (response.ok) {
            const next = (await response.json()) as LiveSnapshot;
            if (done) return;
            setSnapshot(next);
            lastEntryAt = next.lastEntryAt;
            if (next.closed) {
              done = true;
              return;
            }
          }
        } catch {
          // No signal at the moment: try again on the next tick.
        }
      }
      scheduleNext();
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
      else clearTimeout(timer);
    };

    scheduleNext();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      done = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gameId, initial.closed, initial.lastEntryAt, pollFrom, pollUntil]);

  return <LiveLine teamA={teamA} teamB={teamB} snapshot={snapshot} />;
}
