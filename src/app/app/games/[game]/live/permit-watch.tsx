"use client";

import { useSyncExternalStore } from "react";
import { permitAnnouncement } from "@/domain/gameday/announce";
import { type PermitEndRule, permitWatch } from "@/domain/gameday/permit-end";

/** The permit window and rule set saved with the game's screen, as JSON. */
export type PermitProps = {
  /** When play must end: the permit's end, or the end of daylight (#467). */
  permitEndsAt: string;
  endReason: "field_time" | "daylight";
  startsAt: string;
  timeLimitMinutes: number | null;
  innings: number | null;
  rule: PermitEndRule;
};

/** The current minute, kept in step by a timer. */
function subscribe(tick: () => void) {
  const timer = setInterval(tick, 30_000);
  return () => clearInterval(timer);
}
const minute = () => Math.floor(Date.now() / 30_000) * 30_000;
const onServer = () => 0;

/**
 * A warning when the game would run past the end of play (the permit's end,
 * or dark), with the league's rule for that case. The game clock above it
 * counts the minutes left, so this says nothing while all is well. It works from the
 * permit window the page was loaded with and the phone's clock, so it keeps
 * counting with no signal and needs no realtime service.
 */
export function PermitWatchNote({
  permit,
  halvesEntered,
}: {
  permit: PermitProps;
  halvesEntered: number;
}) {
  const stamp = useSyncExternalStore(subscribe, minute, onServer);
  // Before the clock is read (server render, first paint) say nothing
  // rather than something that could be wrong.
  if (stamp === 0) return null;
  const watch = permitWatch({
    permitEndsAt: new Date(permit.permitEndsAt),
    now: new Date(stamp),
    startsAt: new Date(permit.startsAt),
    timeLimitMinutes: permit.timeLimitMinutes,
    innings: permit.innings,
    halvesEntered,
    rule: permit.rule,
    endReason: permit.endReason,
  });
  if (!watch) return null;
  // The end-of-play clock above shows the time left, so only a warning
  // shows here. The visible lines count down every half minute, so they
  // are silent; a hidden status changes only when the phase or a 30, 15 or
  // 5 minute mark does, and that is what a screen reader hears.
  return (
    <>
      {watch.level !== "ok" && (
        <p
          className={`rounded-lg border p-3 font-bold ${
            watch.level === "over" ? "border-danger" : "border-warning"
          }`}
        >
          {watch.message}
        </p>
      )}
      <p role="status" className="sr-only">
        {permitAnnouncement(watch, permit.endReason)}
      </p>
    </>
  );
}
