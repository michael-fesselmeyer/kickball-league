"use client";

import { useSyncExternalStore } from "react";
import {
  type PermitEndRule,
  permitWatch,
  type Watch,
} from "@/domain/gameday/permit-end";

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
 * Where the game stands against the end of play (the permit's end, or
 * dark), from the permit window the page was loaded with and the phone's
 * clock, so it keeps counting with no signal and needs no realtime
 * service. Null until the phone's clock is read, rather than something
 * that could be wrong.
 */
export function usePermitWatch(
  permit: PermitProps | null,
  halvesEntered: number,
): Watch | null {
  const stamp = useSyncExternalStore(subscribe, minute, onServer);
  if (stamp === 0 || !permit) return null;
  return permitWatch({
    permitEndsAt: new Date(permit.permitEndsAt),
    now: new Date(stamp),
    startsAt: new Date(permit.startsAt),
    timeLimitMinutes: permit.timeLimitMinutes,
    innings: permit.innings,
    halvesEntered,
    rule: permit.rule,
    endReason: permit.endReason,
  });
}

/**
 * A warning when the game would run past the end of play, with the
 * league's rule for that case. The end-of-play clock above counts the
 * minutes left, so this shows nothing while all is well. It is silent: the
 * scoring screen's one hidden status carries `permitAnnouncement`, which
 * changes only at a phase change or the 30, 15 and 5 minute marks.
 */
export function PermitWatchNote({ watch }: { watch: Watch }) {
  if (watch.level === "ok") return null;
  return (
    <p
      className={`rounded-lg border p-3 font-bold ${
        watch.level === "over" ? "border-danger" : "border-warning"
      }`}
    >
      {watch.message}
    </p>
  );
}
