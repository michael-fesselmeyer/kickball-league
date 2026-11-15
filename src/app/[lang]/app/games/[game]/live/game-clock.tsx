"use client";

import { useSyncExternalStore } from "react";
import {
  type Clock,
  type GameLimits,
  gameClock,
} from "@/domain/gameday/game-clock";
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
 * Where the game stands against its time limit, on the phone's clock, so it
 * keeps counting with no signal. Null until the phone's clock is read
 * (rather than guess), and when there is nothing to show.
 */
export function useGameClock(
  clock: ClockProps | null,
  next: Position | null,
): Clock | null {
  const stamp = useSyncExternalStore(subscribe, halfMinute, onServer);
  if (stamp === 0 || !clock) return null;
  return gameClock({
    startsAt: new Date(clock.startsAt),
    now: new Date(stamp),
    limits: clock.limits,
    next,
  });
}

/**
 * The time left in the game's time limit, and when no new inning may
 * start. The line counts down every half minute, too often to read out, so
 * it is silent: the scoring screen's one hidden status carries
 * `clockAnnouncement`, which changes only at the last inning, the end and
 * the 30, 15 and 5 minute marks.
 */
export function GameClockNote({ state }: { state: Clock }) {
  return state.level === "running" ? (
    <p className="text-small text-text-muted">{state.message}</p>
  ) : (
    <p
      className={`rounded-lg border p-3 font-bold ${
        state.level === "over" ? "border-danger" : "border-warning"
      }`}
    >
      {state.message}
    </p>
  );
}
