import { isoWeekday } from "./deals";

/**
 * The sponsor's weekly numbers: check-ins, different players, teams that
 * came in and deals used, week by week. Weeks start on Monday in the
 * league's time zone. Pure: the caller passes today's local date.
 */

export type WeekCounts = {
  /** The Monday that starts the week, YYYY-MM-DD. */
  weekOf: string;
  checkIns: number;
  players: number;
  teams: number;
  dealsUsed: number;
};

export type DealCount = { weekOf: string; dealId: string; count: number };

export type ReportWeek = WeekCounts & {
  /** Each deal used that week, most used first. */
  deals: { dealId: string; count: number }[];
};

export type Report = {
  /** Newest first, `weeks` of them, with empty weeks as zeros. */
  weeks: ReportWeek[];
  totals: { checkIns: number; dealsUsed: number };
  /** This week against last week, in check-ins; null with nothing to compare. */
  change: number | null;
};

const DAY_MS = 86_400_000;
const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** The Monday on or before `day`. */
export function weekOf(day: string): string {
  return shift(day, 1 - isoWeekday(day));
}

/** The first day of the oldest week a `weeks`-long report covers. */
export function reportStart(today: string, weeks: number): string {
  return shift(weekOf(today), -7 * (weeks - 1));
}

export function weeklyReport(
  counts: readonly WeekCounts[],
  dealCounts: readonly DealCount[],
  today: string,
  weeks = 8,
): Report {
  const byWeek = new Map(counts.map((c) => [c.weekOf, c]));
  const current = weekOf(today);
  const rows = Array.from({ length: weeks }, (_, i): ReportWeek => {
    const week = shift(current, -7 * i);
    const found = byWeek.get(week);
    const deals = dealCounts
      .filter((d) => d.weekOf === week)
      .map(({ dealId, count }) => ({ dealId, count }))
      .sort((a, b) => b.count - a.count || a.dealId.localeCompare(b.dealId));
    return {
      weekOf: week,
      checkIns: found?.checkIns ?? 0,
      players: found?.players ?? 0,
      teams: found?.teams ?? 0,
      dealsUsed: found?.dealsUsed ?? 0,
      deals,
    };
  });
  const [thisWeek, lastWeek] = rows;
  return {
    weeks: rows,
    totals: {
      checkIns: rows.reduce((n, w) => n + w.checkIns, 0),
      dealsUsed: rows.reduce((n, w) => n + w.dealsUsed, 0),
    },
    change:
      thisWeek && lastWeek && (thisWeek.checkIns > 0 || lastWeek.checkIns > 0)
        ? thisWeek.checkIns - lastWeek.checkIns
        : null,
  };
}

/** "Week of Nov 9" */
export function weekLabel(week: string): string {
  return `Week of ${new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${week}T12:00:00Z`))}`;
}
