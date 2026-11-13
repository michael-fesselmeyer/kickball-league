import { err, ok, type Result } from "../result";

/**
 * "What to request" (ADR 0034): the field time the league needs to ask NYC
 * Parks for, worked out from the season's teams, game days and slot length.
 * NYC Parks has no public permit API, so this is a sheet the owners copy
 * into the application by hand; nothing is sent anywhere.
 *
 * Each game day:
 * - games = teams × games per team ÷ 2, rounded down (an odd team out sits),
 * - each field fits as many back-to-back slots as the day's hours allow,
 * - the league asks for the fewest fields that hold every game, with the
 *   games spread evenly so no field is held longer than it needs,
 * - a team that plays twice needs two different times, so the day has at
 *   least that many slots,
 * - each field's end time is rounded up to the half hour, the unit the
 *   application asks for.
 */

export type RequestInput = {
  teams: number;
  gamesPerTeamPerDay: number;
  /** Game days, YYYY-MM-DD. */
  dates: readonly string[];
  /** Local HH:MM of the first game. */
  firstGame: string;
  /** Local HH:MM by which the last game must end. */
  latestEnd: string;
  slotMinutes: number;
  /** The fields the league usually asks for, in order of preference. */
  fieldNames?: readonly string[];
};

export type RequestRow = {
  date: string;
  field: string;
  start: string;
  end: string;
  minutes: number;
  games: number;
};

export type RequestSheet = {
  gamesPerDay: number;
  slotsPerField: number;
  fieldsNeeded: number;
  rows: RequestRow[];
  totalFieldHours: number;
};

export type RequestProblem =
  "no_teams" | "no_dates" | "bad_time" | "bad_length" | "day_too_short";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOf(time: string): number | null {
  const m = HHMM.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function buildRequestSheet(
  input: RequestInput,
): Result<RequestSheet, RequestProblem> {
  const gamesPerDay = Math.floor((input.teams * input.gamesPerTeamPerDay) / 2);
  if (gamesPerDay < 1) return err("no_teams");
  if (input.dates.length === 0) return err("no_dates");
  const first = minutesOf(input.firstGame);
  const last = minutesOf(input.latestEnd);
  if (first === null || last === null || last <= first) return err("bad_time");
  if (
    !Number.isInteger(input.slotMinutes) ||
    input.slotMinutes < 15 ||
    input.slotMinutes > 480
  )
    return err("bad_length");
  const slotsPerField = Math.floor((last - first) / input.slotMinutes);
  if (slotsPerField < Math.max(1, input.gamesPerTeamPerDay))
    return err("day_too_short");

  // Times in the day: enough for every game on the fewest fields, and at
  // least one per game a team plays.
  const fewest = Math.ceil(gamesPerDay / slotsPerField);
  const times = Math.max(
    input.gamesPerTeamPerDay,
    Math.ceil(gamesPerDay / fewest),
  );
  const fieldsNeeded = Math.ceil(gamesPerDay / times);
  // The first `full` fields hold `times` games; the rest one fewer.
  const full = gamesPerDay - (times - 1) * fieldsNeeded;
  const perField = Array.from({ length: fieldsNeeded }, (_, i) =>
    i < full ? times : times - 1,
  );

  const names = input.fieldNames ?? [];
  const fieldName = (i: number) => names[i] ?? `Field ${i + 1}`;
  const rows = [...input.dates].sort().flatMap((date) =>
    perField.map((games, i) => {
      const end = roundUpToHalfHour(first + games * input.slotMinutes);
      return {
        date,
        field: fieldName(i),
        start: clock(first),
        end: clock(end),
        minutes: end - first,
        games,
      };
    }),
  );
  const totalMinutes = rows.reduce((total, r) => total + r.minutes, 0);
  return ok({
    gamesPerDay,
    slotsPerField,
    fieldsNeeded,
    rows,
    totalFieldHours: totalMinutes / 60,
  });
}

function roundUpToHalfHour(minutes: number): number {
  return Math.ceil(minutes / 30) * 30;
}

/**
 * The season's game days: every `weekday` (0 Sunday to 6 Saturday) from
 * `startsOn` to `endsOn`, without the league-wide blackout dates.
 */
export function gameDates(
  startsOn: string,
  endsOn: string,
  weekday: number,
  blackouts: ReadonlySet<string> = new Set(),
): string[] {
  const day = 86_400_000;
  const start = Date.parse(`${startsOn}T12:00:00Z`);
  const end = Date.parse(`${endsOn}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return [];
  const offset = (weekday - new Date(start).getUTCDay() + 7) % 7;
  const dates: string[] = [];
  for (let at = start + offset * day; at <= end; at += 7 * day) {
    const date = new Date(at).toISOString().slice(0, 10);
    if (!blackouts.has(date)) dates.push(date);
  }
  return dates;
}
