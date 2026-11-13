import {
  buildRequestSheet,
  clock,
  gameDates,
  minutesOf,
} from "@/domain/books/request-sheet";

/**
 * The request sheet's choices, read from the screen's query string (an
 * owners-only screen, so it may), with defaults from the season. Shared by
 * the screen and its CSV, so both show the same sheet.
 */

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type Query = Record<string, string | string[] | undefined>;

const one = (query: Query, name: string) => {
  const value = query[name];
  return typeof value === "string" ? value : undefined;
};

const all = (query: Query, name: string) => {
  const value = query[name];
  return value === undefined ? [] : typeof value === "string" ? [value] : value;
};

const whole = (raw: string | undefined, fallback: number) => {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) ? n : fallback;
};

export type RequestChoices = {
  weekday: number;
  teams: number;
  firstGame: string;
  latestEnd: string;
  slotMinutes: number;
  fieldIds: string[];
};

export function requestChoices(
  query: Query,
  defaults: { teams: number; weekday: number },
): RequestChoices {
  const weekday = whole(one(query, "weekday"), defaults.weekday);
  const time = (name: string, fallback: string) => {
    const raw = one(query, name);
    const minutes = raw === undefined ? null : minutesOf(raw);
    return minutes === null ? fallback : clock(minutes);
  };
  return {
    weekday: weekday >= 0 && weekday <= 6 ? weekday : defaults.weekday,
    teams: Math.max(0, Math.min(200, whole(one(query, "teams"), defaults.teams))),
    firstGame: time("first", "12:00"),
    latestEnd: time("last", "18:00"),
    slotMinutes: whole(one(query, "slot"), 60),
    fieldIds: all(query, "field"),
  };
}

export function requestSheetFor(
  choices: RequestChoices,
  season: { startsOn: string; endsOn: string; gamesPerTeamPerDay: number },
  inputs: {
    blackouts: ReadonlySet<string>;
    fields: readonly { id: string; name: string; venueName: string }[];
  },
) {
  const named = choices.fieldIds.flatMap((id) => {
    const f = inputs.fields.find((x) => x.id === id);
    return f ? [`${f.venueName}, ${f.name}`] : [];
  });
  return buildRequestSheet({
    teams: choices.teams,
    gamesPerTeamPerDay: season.gamesPerTeamPerDay,
    dates: gameDates(
      season.startsOn,
      season.endsOn,
      choices.weekday,
      inputs.blackouts,
    ),
    firstGame: choices.firstGame,
    latestEnd: choices.latestEnd,
    slotMinutes: choices.slotMinutes,
    fieldNames: named,
  });
}

/** The same choices as a query string, for the CSV link. */
export function choicesQuery(choices: RequestChoices): string {
  const params = new URLSearchParams({
    weekday: String(choices.weekday),
    teams: String(choices.teams),
    first: choices.firstGame,
    last: choices.latestEnd,
    slot: String(choices.slotMinutes),
  });
  for (const id of choices.fieldIds) params.append("field", id);
  return params.toString();
}

/** The sheet as lines to paste into the application. */
export function sheetText(
  rows: readonly { date: string; field: string; start: string; end: string }[],
): string {
  return rows
    .map((r) => {
      const day = WEEKDAYS[new Date(`${r.date}T12:00:00Z`).getUTCDay()];
      return `${day} ${r.date}\t${r.field}\t${r.start}–${r.end}`;
    })
    .join("\n");
}
