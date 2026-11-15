/**
 * NYC Parks' athletic permit calendar (docs/permits/nyc-parks.md,
 * "Application windows by season"): three play periods a year, each with a
 * renewal period, a new-request period and a first-come period. Dates are
 * YYYY-MM-DD. The web page's dates are used; Rule 2-12 starts the
 * first-come periods earlier, which the docs note.
 */

export type ParksPeriod = "spring_summer" | "fall" | "winter";

export const PERIOD_LABELS: Readonly<Record<ParksPeriod, string>> = {
  spring_summer: "spring and summer",
  fall: "fall",
  winter: "winter",
};

export type Span = { from: string; to: string };

export type PeriodDates = {
  period: ParksPeriod;
  /** The year play starts: winter 2026 runs December 2026 to March 2027. */
  year: number;
  plays: Span;
  renewals: Span;
  newRequests: Span;
  firstCome: Span;
};

const md = (year: number, monthDay: string) => `${year}-${monthDay}`;

/** One period's dates. */
export function periodDates(period: ParksPeriod, year: number): PeriodDates {
  switch (period) {
    case "spring_summer":
      return {
        period,
        year,
        plays: { from: md(year, "04-01"), to: md(year, "08-31") },
        renewals: { from: md(year - 1, "11-15"), to: md(year - 1, "12-14") },
        newRequests: { from: md(year - 1, "12-30"), to: md(year, "01-30") },
        firstCome: { from: md(year, "03-17"), to: md(year, "08-23") },
      };
    case "fall":
      return {
        period,
        year,
        plays: { from: md(year, "09-01"), to: md(year, "11-30") },
        renewals: { from: md(year, "04-15"), to: md(year, "05-14") },
        newRequests: { from: md(year, "05-30"), to: md(year, "06-30") },
        firstCome: { from: md(year, "08-15"), to: md(year, "11-23") },
      };
    case "winter":
      return {
        period,
        year,
        plays: { from: md(year, "12-01"), to: md(year + 1, "03-31") },
        renewals: { from: md(year, "09-15"), to: md(year, "10-14") },
        newRequests: { from: md(year, "10-21"), to: md(year, "11-08") },
        firstCome: { from: md(year, "11-18"), to: md(year + 1, "03-23") },
      };
  }
}

/** The play period a date falls in. */
export function periodOf(on: string): PeriodDates {
  const year = Number(on.slice(0, 4));
  const monthDay = on.slice(5);
  if (monthDay >= "04-01" && monthDay <= "08-31")
    return periodDates("spring_summer", year);
  if (monthDay >= "09-01" && monthDay <= "11-30")
    return periodDates("fall", year);
  return periodDates("winter", monthDay >= "12-01" ? year : year - 1);
}

/** The same period a year later: the one a returning league renews into. */
export function nextYear(p: PeriodDates): PeriodDates {
  return periodDates(p.period, p.year + 1);
}

export const within = (on: string, span: Span) =>
  on >= span.from && on <= span.to;
