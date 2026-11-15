import { money } from "../books/ledger";
import type { DashboardView } from "./view";

/**
 * The season report card (issue #371): one season beside the one before,
 * line by line, with the actual numbers and a plain-language change. Pure:
 * the page hands over each season's facts and this builds the lines, the
 * words and the arrows. Counts and totals only; nothing names a person.
 */

/** Everything the report card says about one season. */
export type SeasonFacts = {
  name: string;
  members: number;
  returning: number;
  newMembers: number;
  /** Share of the season before's members who came back; null for the first. */
  retention: number | null;
  teams: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Mean of the season survey's ratings (1 to 5); null with no survey answers. */
  surveyAverage: number | null;
  surveyAnswers: number;
  /** Mean sportsmanship rating (1 to 5); null with no ratings. */
  sportsmanshipAverage: number | null;
  gamesPlayed: number;
  /** Game times called off by rain-outs. */
  rainedOut: number;
  events: number;
  /** RSVPs marked going, across the season's events. */
  eventGoing: number;
  /** Tickets scanned at the door, across ticketed events. */
  eventCheckedIn: number;
  sponsorCheckins: number;
};

/** The survey, sportsmanship and games numbers the dashboard doesn't carry. */
export type FactExtras = Pick<
  SeasonFacts,
  | "surveyAverage"
  | "surveyAnswers"
  | "sportsmanshipAverage"
  | "gamesPlayed"
  | "rainedOut"
>;

const sum = (values: readonly number[]) =>
  values.reduce((total, v) => total + v, 0);

/**
 * A season's facts from the owner dashboard's view of that season (its
 * membership and money for every season, and the chosen season's teams,
 * events and check-ins) and the extra reads.
 */
export function factsFrom(
  view: DashboardView,
  season: { id: string; name: string },
  extras: FactExtras,
): SeasonFacts {
  const members = view.membership.find((m) => m.seasonId === season.id);
  const books = view.money.find((m) => m.seasonId === season.id);
  const { selected } = view;
  return {
    name: season.name,
    members: members?.members ?? 0,
    returning: members?.returning ?? 0,
    newMembers: members?.newMembers ?? 0,
    retention: members?.retention ?? null,
    teams: selected.teams.filter((t) => t.teamSeasonId !== null).length,
    incomeCents: books?.incomeCents ?? 0,
    expenseCents: books?.expenseTotalCents ?? 0,
    netCents: books?.netCents ?? 0,
    events: selected.events.length,
    eventGoing: sum(selected.events.map((e) => e.signedUp)),
    eventCheckedIn: sum(selected.events.map((e) => e.checkedIn ?? 0)),
    sponsorCheckins: sum(selected.checkins.map((w) => w.checkins)),
    ...extras,
  };
}

/** Seasons with a report card: running or done, never one not started. */
export const REPORT_STATUSES = ["in_progress", "playoffs", "completed"];

export type LineKind = "count" | "money" | "percent" | "score";

export type Section = "People" | "Money" | "Games" | "Community";

export type ReportLine = {
  section: Section;
  label: string;
  kind: LineKind;
  current: number | null;
  previous: number | null;
  /** Which way is good news, or neither. */
  better: "up" | "down" | "neither";
};

type Spec = Omit<ReportLine, "current" | "previous"> & {
  value: (f: SeasonFacts) => number | null;
};

const SPECS: readonly Spec[] = [
  {
    section: "People",
    label: "Players registered",
    kind: "count",
    better: "up",
    value: (f) => f.members,
  },
  {
    section: "People",
    label: "Returning players",
    kind: "count",
    better: "up",
    value: (f) => f.returning,
  },
  {
    section: "People",
    label: "New players",
    kind: "count",
    better: "up",
    value: (f) => f.newMembers,
  },
  {
    section: "People",
    label: "Back from the season before",
    kind: "percent",
    better: "up",
    value: (f) => f.retention,
  },
  {
    section: "People",
    label: "Teams",
    kind: "count",
    better: "up",
    value: (f) => f.teams,
  },
  {
    section: "Money",
    label: "Money in",
    kind: "money",
    better: "up",
    value: (f) => f.incomeCents,
  },
  {
    section: "Money",
    label: "Money out",
    kind: "money",
    better: "neither",
    value: (f) => f.expenseCents,
  },
  {
    section: "Money",
    label: "Net",
    kind: "money",
    better: "up",
    value: (f) => f.netCents,
  },
  {
    section: "Games",
    label: "Games played",
    kind: "count",
    better: "up",
    value: (f) => f.gamesPlayed,
  },
  {
    section: "Games",
    label: "Game times rained out",
    kind: "count",
    better: "down",
    value: (f) => f.rainedOut,
  },
  {
    section: "Games",
    label: "Sportsmanship average",
    kind: "score",
    better: "up",
    value: (f) => f.sportsmanshipAverage,
  },
  {
    section: "Community",
    label: "Season survey average",
    kind: "score",
    better: "up",
    value: (f) => f.surveyAverage,
  },
  {
    section: "Community",
    label: "Survey answers",
    kind: "count",
    better: "up",
    value: (f) => f.surveyAnswers,
  },
  {
    section: "Community",
    label: "Events",
    kind: "count",
    better: "up",
    value: (f) => f.events,
  },
  {
    section: "Community",
    label: "Going to events",
    kind: "count",
    better: "up",
    value: (f) => f.eventGoing,
  },
  {
    section: "Community",
    label: "Checked in at ticketed events",
    kind: "count",
    better: "up",
    value: (f) => f.eventCheckedIn,
  },
  {
    section: "Community",
    label: "Sponsor bar check-ins",
    kind: "count",
    better: "up",
    value: (f) => f.sponsorCheckins,
  },
];

export const SECTIONS: readonly Section[] = [
  "People",
  "Money",
  "Games",
  "Community",
];

/**
 * The report card's lines. The shareable version leaves out the money
 * section: it goes to sponsors, who see how the league is doing, not its
 * books.
 */
export function reportLines(
  current: SeasonFacts,
  previous: SeasonFacts | null,
  { share = false }: { share?: boolean } = {},
): ReportLine[] {
  return SPECS.filter((s) => !(share && s.section === "Money")).map(
    ({ value, ...line }) => ({
      ...line,
      current: value(current),
      previous: previous ? value(previous) : null,
    }),
  );
}

/** One value, as the report card shows it. */
export function show(kind: LineKind, value: number | null): string {
  if (value === null) return "–";
  switch (kind) {
    case "money":
      return money(value);
    case "percent":
      return `${Math.round(value * 100)}%`;
    case "score":
      return `${value.toFixed(1)} of 5`;
    default:
      return value.toLocaleString("en-US");
  }
}

/** How big a change is, in the line's own unit. */
function amount(kind: LineKind, delta: number): string {
  const size = Math.abs(delta);
  switch (kind) {
    case "money":
      return money(size);
    case "percent": {
      const points = Math.round(size * 100);
      return `${points} ${points === 1 ? "point" : "points"}`;
    }
    case "score":
      return size.toFixed(1);
    default:
      return size.toLocaleString("en-US");
  }
}

export type Change = {
  direction: "up" | "down" | "same" | "none";
  /** Up and good, down and good, or neither (no change, no comparison). */
  tone: "good" | "bad" | "neutral";
  /** "Up 6 from Fall 2026", "Same as Fall 2026", "Nothing to compare". */
  words: string;
  /** ▲, ▼ or –, shown beside the words; screen readers read the words. */
  arrow: "▲" | "▼" | "–";
};

/**
 * The change from the season before in plain words. Equal after rounding
 * to what is shown (whole points, one decimal of a score) reads as the same.
 */
export function change(line: ReportLine, previousName: string | null): Change {
  if (line.current === null || line.previous === null || !previousName)
    return {
      direction: "none",
      tone: "neutral",
      words: previousName
        ? `No ${previousName} figure to compare`
        : "Nothing to compare",
      arrow: "–",
    };
  const shown = (v: number) =>
    line.kind === "percent"
      ? Math.round(v * 100)
      : line.kind === "score"
        ? Math.round(v * 10)
        : v;
  const delta = line.current - line.previous;
  if (shown(line.current) === shown(line.previous))
    return {
      direction: "same",
      tone: "neutral",
      words: `Same as ${previousName}`,
      arrow: "–",
    };
  const direction = delta > 0 ? "up" : "down";
  return {
    direction,
    tone:
      line.better === "neither"
        ? "neutral"
        : line.better === direction
          ? "good"
          : "bad",
    words: `${direction === "up" ? "Up" : "Down"} ${amount(line.kind, delta)} from ${previousName}`,
    arrow: direction === "up" ? "▲" : "▼",
  };
}
