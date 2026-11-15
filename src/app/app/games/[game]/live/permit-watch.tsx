"use client";

import { useSyncExternalStore } from "react";
import { type PermitEndRule, permitWatch } from "@/domain/gameday/permit-end";

/** The permit window and rule set saved with the game's screen, as JSON. */
export type PermitProps = {
  permitEndsAt: string;
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
 * The minutes left in the field's permit, and a warning when the game would
 * run past it, with the league's rule for that case. It works from the
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
  });
  if (!watch) return null;
  if (watch.level === "ok")
    return (
      <p role="status" className="text-small text-text-muted">
        {watch.message}
      </p>
    );
  return (
    <p
      role="alert"
      className={`rounded-lg border p-3 font-bold ${
        watch.level === "over" ? "border-danger" : "border-warning"
      }`}
    >
      {watch.message}
    </p>
  );
}
