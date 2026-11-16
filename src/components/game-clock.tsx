"use client";

import { useSyncExternalStore } from "react";
import {
  countdown,
  countdownMessage,
  type EndReason,
} from "@/domain/gameday/daylight";

/** A game's clock as the server saw it, as JSON (issue #467). */
export type GameClockProps = {
  /** ISO instants. */
  firstPitchAt: string;
  startedAt: string | null;
  endsAt: string;
  endReason: EndReason;
  /** "7:12 PM", in the league's time zone. */
  endLabel: string;
  /** "7:27 PM", for a daylight end. */
  sunsetLabel: string | null;
};

function subscribe(tick: () => void) {
  const timer = setInterval(tick, 15_000);
  return () => clearInterval(timer);
}
const quarterMinute = () => Math.floor(Date.now() / 15_000) * 15_000;
const onServer = () => 0;

/**
 * When play must end and why, with a countdown to first pitch and then to
 * that end. It counts on the phone's own clock from what the page was
 * loaded with, so it keeps going with no signal and needs no realtime
 * service. The server and the first paint show only the end time, which
 * cannot be wrong; the countdown follows once the phone's clock is read.
 */
export function GameClock({ clock }: { clock: GameClockProps }) {
  const stamp = useSyncExternalStore(subscribe, quarterMinute, onServer);
  const end = { endsAt: new Date(clock.endsAt), reason: clock.endReason };
  const state =
    stamp === 0
      ? null
      : countdown({
          firstPitchAt: new Date(clock.firstPitchAt),
          startedAt: clock.startedAt ? new Date(clock.startedAt) : null,
          endsAt: end.endsAt,
          now: new Date(stamp),
        });
  const urgent = state?.phase === "late" || state?.phase === "over";
  return (
    <section
      aria-label="End of play"
      className={`flex flex-col gap-1 rounded-lg border p-3 ${
        urgent ? "border-danger" : "border-border"
      }`}
    >
      <p className="font-bold">
        Play must end by {clock.endLabel}
        <span className="font-normal text-text-muted">
          {clock.endReason === "daylight"
            ? ` · sunset ${clock.sunsetLabel ?? "soon after"}`
            : " · the field must be clear"}
        </span>
      </p>
      {/* A min-height keeps the line's space before the clock is read. */}
      <p role="timer" aria-live="off" className="min-h-10 text-small">
        {state ? countdownMessage(state, end) : null}
      </p>
    </section>
  );
}
