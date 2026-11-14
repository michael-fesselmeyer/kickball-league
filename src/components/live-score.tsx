"use client";

import { startTransition, useEffect, useState } from "react";
import { type LiveSnapshot, nextPollIn, POLL_MS } from "@/domain/scores/live";
import { LiveLine } from "./line-score";

/**
 * The live line score on the public game page (ADR 0011). The page renders
 * it with the score at render time; while the game is on and the tab is
 * visible, it asks the live JSON route again every 10 seconds, so a new
 * half-inning shows within 15 seconds without a reload. It stops once the
 * game is final, and when the game is not on it does not poll at all.
 *
 * The page is static HTML kept per game, so the copy a visitor gets may be
 * from before the latest half-inning, or from before the first one, with no
 * line score yet (`initial` null). So it also asks once as soon as it loads,
 * and renders nothing until there is a score to show.
 *
 * Each update is a transition, so changed totals flip like a scoreboard,
 * and a result that arrives while the page is open gets the winner moment
 * (src/components/motion.tsx). A page opened after the final gets neither.
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
  initial: LiveSnapshot | null;
  /** ISO times: the game's window, from shortly before it starts. */
  pollFrom: string;
  pollUntil: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [celebrate, setCelebrate] = useState(false);
  const initiallyFinal = (initial?.result ?? null) !== null;
  const initiallyClosed = initial?.closed ?? false;
  const initialEntryAt = initial?.lastEntryAt ?? null;

  useEffect(() => {
    if (initiallyClosed) return;
    const from = Date.parse(pollFrom);
    const until = Date.parse(pollUntil);
    let lastEntryAt = initialEntryAt;
    let hadResult = initiallyFinal;
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
    /** Asks once; false once the game is closed and nothing more will come. */
    async function ask(): Promise<boolean> {
      try {
        const response = await fetch(`/api/games/${gameId}/live`);
        if (response.ok) {
          const next = (await response.json()) as LiveSnapshot;
          if (done) return false;
          const wentFinal = next.result !== null && !hadResult;
          hadResult = next.result !== null;
          startTransition(() => {
            setSnapshot(next);
            if (wentFinal) setCelebrate(true);
          });
          lastEntryAt = next.lastEntryAt;
          if (next.closed) {
            done = true;
            return false;
          }
        }
      } catch {
        // No signal at the moment: try again on the next tick.
      }
      return true;
    }
    async function tick() {
      if (done || document.visibilityState !== "visible") return;
      // Before the window this only waits on; inside it, it asks.
      if (wait() === POLL_MS && !(await ask())) return;
      scheduleNext();
    }
    /** The page's copy may be older than the score: ask once at the start. */
    async function start() {
      if (document.visibilityState === "visible" && !(await ask())) return;
      scheduleNext();
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
      else clearTimeout(timer);
    };

    void start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      done = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    gameId,
    initiallyClosed,
    initialEntryAt,
    initiallyFinal,
    pollFrom,
    pollUntil,
  ]);

  if (!snapshot) return null;
  return (
    <LiveLine
      teamA={teamA}
      teamB={teamB}
      snapshot={snapshot}
      celebrate={celebrate}
    />
  );
}
