import type { Metric, Metrics } from "@/domain/scheduler/measure";

/**
 * The scheduler names games by key (`r3:<team id>:<team id>`) and teams by
 * id; this shows team names instead.
 */
export function readable(note: string, teams: ReadonlyMap<string, string>) {
  return note
    .replace(
      /r(\d+):([0-9a-f-]{36}):([0-9a-f-]{36})/g,
      (key, round: string, a: string, b: string) =>
        teams.has(a) && teams.has(b)
          ? `${teams.get(a)} vs ${teams.get(b)} (round ${round})`
          : key,
    )
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (id) => teams.get(id) ?? id);
}

export type MetricRow = {
  label: string;
  metric: Metric;
  /** The smallest value any schedule could reach, where the scheduler knows it. */
  best: number | null;
};

/** The fairness metrics the schedule screen and the board show, in order. */
export function metricRows(metrics: Metrics): MetricRow[] {
  return [
    {
      label: "Time-slot spread",
      metric: metrics.timeSlotSpread,
      best: metrics.timeSlotSpread.bestPossible,
    },
    {
      label: "Field spread",
      metric: metrics.fieldSpread,
      best: metrics.fieldSpread.bestPossible,
    },
    {
      label: "Longest same-slot streak",
      metric: metrics.longestStreak,
      best: null,
    },
    {
      label: "Doubleheader wait",
      metric: metrics.doubleheaderWait,
      best: null,
    },
    { label: "Bye balance", metric: metrics.byeBalance, best: null },
    { label: "Unplaced games", metric: metrics.unplaced, best: null },
    {
      label: "Makeup slots left",
      metric: metrics.reserveRemaining,
      best: null,
    },
  ];
}
