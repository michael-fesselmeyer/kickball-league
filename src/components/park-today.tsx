"use client";

import { useSyncExternalStore } from "react";

export type TodayDay = {
  /** YYYY-MM-DD in the league's time zone. */
  date: string;
  label: string;
  /** What the league holds that day, ready to show. */
  lines: string[];
  /** The instant the last window of the day ends. */
  endsAt: string;
};

/** The current minute, kept in step by a timer; 0 while rendering on the server. */
function subscribe(tick: () => void) {
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;
const onServer = () => 0;

const todayIn = (timeZone: string, now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/**
 * The line at the top of a park's page. The page itself is static HTML, so
 * which day is today is worked out in the browser from the cached permit
 * days and the park's time zone; until then, and without script, the full
 * list below says the same.
 */
export function ParkToday({
  days,
  timeZone,
}: {
  days: TodayDay[];
  timeZone: string;
}) {
  const stamp = useSyncExternalStore(subscribe, minute, onServer);
  const now = new Date(stamp);
  if (stamp === 0)
    return (
      <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
        The days the league holds a field are listed below.
      </p>
    );
  const today = todayIn(timeZone, now);
  const live = days.filter((d) => new Date(d.endsAt) > now);
  // A permit that began last evening and runs past midnight is still the
  // league's now, though its day is yesterday's.
  const underWay = live.find((d) => d.date < today);
  const mine = underWay ?? live.find((d) => d.date === today);
  const next = live.find((d) => d.date > today);
  return (
    <div
      className="rounded-card border border-border bg-surface p-4"
      role="status"
    >
      {mine ? (
        <>
          <p className="text-h3">
            {underWay ? "Right now" : "Today"} the league holds
          </p>
          <ul className="mt-1">
            {mine.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          <span className="text-h3">The league has no permit here today.</span>{" "}
          {next
            ? `Next permitted day: ${next.label}.`
            : "No permitted days are posted yet."}
        </p>
      )}
    </div>
  );
}
