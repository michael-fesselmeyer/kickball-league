"use client";

import { useEffect, useState } from "react";
import type { LiveSnapshot } from "@/domain/scores/live";
import { LiveLine } from "./line-score";

/** How often the page asks for the score while the game is on. */
export const POLL_MS = 10_000;

/**
 * The live line score on the public game page (ADR 0009). The page renders
 * it with the score at render time; while the game is on and the tab is
 * visible, it asks the live JSON route again every 10 seconds, so a new
 * half-inning shows within 15 seconds without a reload. It stops once the
 * game is final, and outside the game's window it never polls at all.
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
  /** ISO times: when polling may start and must stop. */
  pollFrom: string;
  pollUntil: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);

  useEffect(() => {
    if (initial.closed) return;
    const from = Date.parse(pollFrom);
    const until = Date.parse(pollUntil);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };
    async function tick() {
      if (done || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now > until) return;
      // Before the game, check back when it is about to start.
      if (now < from) return schedule(Math.min(from - now, 60 * 60_000));
      try {
        const response = await fetch(`/api/games/${gameId}/live`);
        if (response.ok) {
          const next = (await response.json()) as LiveSnapshot;
          if (done) return;
          setSnapshot(next);
          if (next.closed) {
            done = true;
            return;
          }
        }
      } catch {
        // No signal at the moment: try again on the next tick.
      }
      schedule(POLL_MS);
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
      else clearTimeout(timer);
    };

    schedule(POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      done = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gameId, initial.closed, pollFrom, pollUntil]);

  return <LiveLine teamA={teamA} teamB={teamB} snapshot={snapshot} />;
}
