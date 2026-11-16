"use client";

import { useSyncExternalStore } from "react";
import { clockAnnouncement } from "@/domain/gameday/announce";
import { type GameLimits, gameClock } from "@/domain/gameday/game-clock";
import type { Position } from "@/domain/scores/live";

/** The game's start and limits, saved with the screen as JSON. */
export type ClockProps = { startsAt: string; limits: GameLimits };

function subscribe(tick: () => void) {
  const timer = setInterval(tick, 30_000);
  return () => clearInterval(timer);
}
const halfMinute = () => Math.floor(Date.now() / 30_000) * 30_000;
const onServer = () => 0;

/**
 * The time left in the game's time limit, and when no new inning may
 * start. It runs on the phone's clock, so it keeps counting with no signal.
 */
export function GameClockNote({
  clock,
  next,
}: {
  clock: ClockProps;
  next: Position | null;
}) {
  const stamp = useSyncExternalStore(subscribe, halfMinute, onServer);
  // Say nothing until the phone's clock is read, rather than guess.
  if (stamp === 0) return null;
  const state = gameClock({
    startsAt: new Date(clock.startsAt),
    now: new Date(stamp),
    limits: clock.limits,
    next,
  });
  if (!state) return null;
  // The visible line counts down every half minute, too often to read
  // out, so it is silent. A hidden status carries the sentence that changes
  // only at the last inning, the end and the 30, 15 and 5 minute marks.
  return (
    <>
      {state.level === "running" ? (
        <p className="text-small text-text-muted">{state.message}</p>
      ) : (
        <p
          className={`rounded-lg border p-3 font-bold ${
            state.level === "over" ? "border-danger" : "border-warning"
          }`}
        >
          {state.message}
        </p>
      )}
      <p role="status" className="sr-only">
        {clockAnnouncement(state)}
      </p>
    </>
  );
}
