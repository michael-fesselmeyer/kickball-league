import {
  buildRequestSheet,
  clock,
  gameDates,
} from "@/domain/books/request-sheet";

/**
 * The capacity planner (docs/permits/nyc-parks.md): how many teams the field
 * time a season holds can fit, how far short that is of the teams that want
 * to play, and what would close the gap.
 *
 * A season fits n teams when every team can play its games:
 * - each game day holds as many games as its permit windows have slots
 *   (back-to-back games of the chosen length, cut from each window), but
 *   never more than n × games a team plays that day ÷ 2, rounded down,
 * - the days together hold at least n × games per team ÷ 2 games, rounded up.
 *
 * This is a bound the schedule can meet, not a schedule: the scheduler still
 * places the games. An odd count of teams can fit fewer than one more team
 * does (someone sits out every day), so the planner looks at every count
 * rather than stopping at the first that fails.
 */

/** The most teams the planner considers, the same cap as the request sheet. */
export const MAX_TEAMS = 200;
export const MIN_GAME_MINUTES = 20;
export const MAX_GAME_MINUTES = 240;
export const MAX_GAMES_PER_TEAM = 40;

export type PlanWindow = {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Which field, so windows on one field can be told apart. */
  fieldKey: string;
  /** Local minutes after midnight. */
  start: number;
  end: number;
};

export type PlanInput = {
  season: { startsOn: string; endsOn: string };
  /** The season's permit windows, without lost ones. */
  windows: readonly PlanWindow[];
  /** Dates with no play anywhere. */
  blackouts?: ReadonlySet<string>;
  gameMinutes: number;
  gamesPerTeam: number;
  gamesPerTeamPerDay: 1 | 2;
  /** Teams entered plus teams waiting for a place. */
  wanted: number;
  /** The field the league uses most, for options that add time on it. */
  mainField?: { id: string | null; name: string };
  /** Another field to ask for, for the "one more field" option. */
  spareField?: { id: string | null; name: string };
};

export type Capacity = {
  teams: number;
  gameDays: number;
  /** Games the windows hold, before the per-day cap. */
  slots: number;
  fieldHours: number;
};

/** What to ask NYC Parks for: the request sheet's choices for one option. */
export type ExtraRequest = {
  weekday: number;
  first: string;
  last: string;
  gamesPerDay: number;
  slotMinutes: number;
  fieldId: string | null;
  fieldName: string;
  dates: number;
  fieldHours: number;
  /** Extra games the request adds; less than the games short when it can't hold them all. */
  games: number;
};

export type OptionKind =
  | "shorter_games"
  | "doubleheaders"
  | "extra_weeknight"
  | "weekend_daytime"
  | "more_fields"
  | "divisions"
  | "shorter_season";

export type PlanOption = {
  kind: OptionKind;
  /** The most teams the season fits with this change. */
  teams: number;
  extraTeams: number;
  closesGap: boolean;
  /** The change itself, for the screen to describe. */
  gameMinutes?: number;
  gamesPerTeam?: number;
  weekday?: number;
  first?: string;
  last?: string;
  fieldName?: string;
  /** Field time evenings after about 6:30 pm in the fall need lights. */
  needsLights?: boolean;
  /** Field hours to request for exactly the teams that want in, if any. */
  request?: ExtraRequest;
};

export type Plan = {
  capacity: Capacity;
  wanted: number;
  /** Teams that want to play but don't fit; 0 when everyone fits. */
  gap: number;
  /** Games short for the teams that want in, with the field time held. */
  gamesShort: number;
  options: PlanOption[];
};

export function slotsIn(window: PlanWindow, gameMinutes: number): number {
  if (window.end <= window.start || gameMinutes <= 0) return 0;
  return Math.floor((window.end - window.start) / gameMinutes);
}

/** Slots per game day, one entry per date. */
export function slotsByDate(
  windows: readonly PlanWindow[],
  gameMinutes: number,
  blackouts: ReadonlySet<string> = new Set(),
): number[] {
  const byDate = new Map<string, number>();
  for (const w of windows) {
    if (blackouts.has(w.date)) continue;
    byDate.set(w.date, (byDate.get(w.date) ?? 0) + slotsIn(w, gameMinutes));
  }
  return [...byDate.values()].filter((s) => s > 0);
}

/** Games n teams can play, at most `perDay` slots used each day. */
export function playable(
  slotsPerDay: readonly number[],
  teams: number,
  gamesPerTeamPerDay: number,
): number {
  const cap = Math.floor((teams * gamesPerTeamPerDay) / 2);
  return slotsPerDay.reduce((total, s) => total + Math.min(s, cap), 0);
}

export function gamesNeeded(teams: number, gamesPerTeam: number): number {
  return Math.ceil((teams * gamesPerTeam) / 2);
}

export function fits(
  slotsPerDay: readonly number[],
  teams: number,
  gamesPerTeam: number,
  gamesPerTeamPerDay: number,
): boolean {
  if (teams < 2) return false;
  return (
    playable(slotsPerDay, teams, gamesPerTeamPerDay) >=
    gamesNeeded(teams, gamesPerTeam)
  );
}

/** The most teams the slots fit, or 0 if not even two teams fit. */
export function maxTeams(
  slotsPerDay: readonly number[],
  gamesPerTeam: number,
  gamesPerTeamPerDay: number,
  limit = MAX_TEAMS,
): number {
  for (let n = limit; n >= 2; n -= 1) {
    if (fits(slotsPerDay, n, gamesPerTeam, gamesPerTeamPerDay)) return n;
  }
  return 0;
}

const WEEKNIGHT = { first: 18 * 60 + 30, last: 21 * 60 + 30 };
const WEEKEND_DAY = { first: 10 * 60, last: 16 * 60 };
/** Tuesday, Wednesday, Monday, Thursday: the order a free night is tried. */
const WEEKNIGHTS = [2, 3, 1, 4] as const;
/** Lit fields: by late September it is dark around 6:40 pm in New York. */
const DARK_BY = 18 * 60 + 30;

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

function capacityOf(
  windows: readonly PlanWindow[],
  input: PlanInput,
  overrides: Partial<
    Pick<PlanInput, "gameMinutes" | "gamesPerTeam" | "gamesPerTeamPerDay">
  > = {},
): number {
  const gameMinutes = overrides.gameMinutes ?? input.gameMinutes;
  return maxTeams(
    slotsByDate(windows, gameMinutes, input.blackouts),
    overrides.gamesPerTeam ?? input.gamesPerTeam,
    overrides.gamesPerTeamPerDay ?? input.gamesPerTeamPerDay,
  );
}

/** New windows on `weekday` every week of the season, on one field. */
function addedWindows(
  input: PlanInput,
  weekday: number,
  hours: { first: number; last: number },
  fieldKey: string,
): PlanWindow[] {
  return gameDates(
    input.season.startsOn,
    input.season.endsOn,
    weekday,
    input.blackouts,
  ).map((date) => ({ date, fieldKey, start: hours.first, end: hours.last }));
}

/**
 * The request for exactly the games the season is short, spread over the
 * new dates: no more per day than the new window holds or the wanted teams
 * can play.
 */
function requestFor(
  input: PlanInput,
  gamesShort: number,
  weekday: number,
  hours: { first: number; last: number },
  field: { id: string | null; name: string },
  dates: readonly string[],
): ExtraRequest | undefined {
  if (gamesShort <= 0 || dates.length === 0) return undefined;
  const perWindow = Math.floor((hours.last - hours.first) / input.gameMinutes);
  const perTeams = Math.floor((input.wanted * input.gamesPerTeamPerDay) / 2);
  const gamesPerDay = Math.min(
    perWindow,
    perTeams,
    Math.ceil(gamesShort / dates.length),
  );
  if (gamesPerDay < 1) return undefined;
  const sheet = buildRequestSheet({
    teams: 0,
    gamesPerDay,
    gamesPerTeamPerDay: input.gamesPerTeamPerDay,
    dates,
    firstGame: clock(hours.first),
    latestEnd: clock(hours.last),
    slotMinutes: input.gameMinutes,
    fieldNames: [field.name],
  });
  if (!sheet.ok) return undefined;
  return {
    weekday,
    first: clock(hours.first),
    last: clock(hours.last),
    gamesPerDay,
    slotMinutes: input.gameMinutes,
    fieldId: field.id,
    fieldName: field.name,
    dates: dates.length,
    fieldHours: sheet.value.totalFieldHours,
    games: gamesPerDay * dates.length,
  };
}

export function buildPlan(input: PlanInput): Plan {
  const perDay = slotsByDate(input.windows, input.gameMinutes, input.blackouts);
  const teams = maxTeams(perDay, input.gamesPerTeam, input.gamesPerTeamPerDay);
  const minutes = input.windows
    .filter((w) => !input.blackouts?.has(w.date))
    .reduce((total, w) => total + Math.max(0, w.end - w.start), 0);
  const capacity: Capacity = {
    teams,
    gameDays: perDay.length,
    slots: perDay.reduce((a, b) => a + b, 0),
    fieldHours: minutes / 60,
  };
  const wanted = Math.max(0, Math.min(MAX_TEAMS, Math.floor(input.wanted)));
  const gap = Math.max(0, wanted - teams);
  const gamesShort =
    gap === 0 || wanted < 2
      ? 0
      : Math.max(
          0,
          gamesNeeded(wanted, input.gamesPerTeam) -
            playable(perDay, wanted, input.gamesPerTeamPerDay),
        );

  const option = (
    kind: OptionKind,
    withIt: number,
    rest: Omit<PlanOption, "kind" | "teams" | "extraTeams" | "closesGap">,
  ): PlanOption => ({
    kind,
    teams: withIt,
    extraTeams: Math.max(0, withIt - teams),
    closesGap: wanted > 0 && withIt >= wanted,
    ...rest,
  });
  const options: PlanOption[] = [];

  // Shorter games or tighter slots: the smallest cut that fits the most.
  let shorter: PlanOption | undefined;
  for (const cut of [5, 10, 15]) {
    const gameMinutes = input.gameMinutes - cut;
    if (gameMinutes < MIN_GAME_MINUTES) break;
    const withIt = capacityOf(input.windows, input, { gameMinutes });
    if (!shorter || withIt > shorter.teams)
      shorter = option("shorter_games", withIt, { gameMinutes });
  }
  if (shorter) options.push(shorter);

  if (input.gamesPerTeamPerDay === 1) {
    options.push(
      option(
        "doubleheaders",
        capacityOf(input.windows, input, { gamesPerTeamPerDay: 2 }),
        {},
      ),
    );
  }

  const used = new Set(input.windows.map((w) => weekdayOf(w.date)));
  const main = input.mainField ?? { id: null, name: "Your main field" };

  const night = WEEKNIGHTS.find((d) => !used.has(d));
  if (night !== undefined) {
    const added = addedWindows(input, night, WEEKNIGHT, "extra-night");
    const dates = added.map((w) => w.date);
    options.push(
      option(
        "extra_weeknight",
        capacityOf([...input.windows, ...added], input),
        {
          weekday: night,
          first: clock(WEEKNIGHT.first),
          last: clock(WEEKNIGHT.last),
          fieldName: main.name,
          needsLights: WEEKNIGHT.last > DARK_BY,
          request: requestFor(input, gamesShort, night, WEEKNIGHT, main, dates),
        },
      ),
    );
    // Two divisions: the second plays only on the new night, so each
    // division has to fit on its own.
    const second = capacityOf(added, input);
    const divisionShort =
      gap === 0 ? 0 : gamesNeeded(Math.max(gap, 2), input.gamesPerTeam);
    options.push(
      option("divisions", second > 0 ? teams + second : teams, {
        weekday: night,
        first: clock(WEEKNIGHT.first),
        last: clock(WEEKNIGHT.last),
        fieldName: main.name,
        needsLights: WEEKNIGHT.last > DARK_BY,
        request: requestFor(
          { ...input, wanted: Math.max(gap, 2) },
          divisionShort,
          night,
          WEEKNIGHT,
          main,
          dates,
        ),
      }),
    );
  }

  const weekend = [6, 0].find((d) => !used.has(d));
  if (weekend !== undefined) {
    const added = addedWindows(input, weekend, WEEKEND_DAY, "weekend");
    options.push(
      option(
        "weekend_daytime",
        capacityOf([...input.windows, ...added], input),
        {
          weekday: weekend,
          first: clock(WEEKEND_DAY.first),
          last: clock(WEEKEND_DAY.last),
          fieldName: main.name,
          request: requestFor(
            input,
            gamesShort,
            weekend,
            WEEKEND_DAY,
            main,
            added.map((w) => w.date),
          ),
        },
      ),
    );
  }

  // One more field, at the times of the league's busiest weekly window.
  const busiest = busiestPattern(input.windows);
  if (busiest) {
    const spare = input.spareField ?? { id: null, name: "Another field" };
    const copies = input.windows.map((w) => ({
      ...w,
      fieldKey: `${w.fieldKey}+spare`,
    }));
    const dates = [
      ...new Set(
        input.windows
          .filter(
            (w) =>
              weekdayOf(w.date) === busiest.weekday &&
              !input.blackouts?.has(w.date),
          )
          .map((w) => w.date),
      ),
    ].sort();
    options.push(
      option("more_fields", capacityOf([...input.windows, ...copies], input), {
        weekday: busiest.weekday,
        first: clock(busiest.start),
        last: clock(busiest.end),
        fieldName: spare.name,
        needsLights: busiest.end > DARK_BY,
        request: requestFor(
          input,
          gamesShort,
          busiest.weekday,
          { first: busiest.start, last: busiest.end },
          spare,
          dates,
        ),
      }),
    );
  }

  const fewer = input.gamesPerTeam - 2;
  if (fewer >= 1) {
    options.push(
      option(
        "shorter_season",
        capacityOf(input.windows, input, { gamesPerTeam: fewer }),
        { gamesPerTeam: fewer },
      ),
    );
  }

  return { capacity, wanted, gap, gamesShort, options };
}

/** The weekday, start and end that the most windows share. */
export function busiestPattern(windows: readonly PlanWindow[]) {
  const counts = new Map<
    string,
    { weekday: number; start: number; end: number; count: number }
  >();
  for (const w of windows) {
    const weekday = weekdayOf(w.date);
    const key = `${weekday}/${w.start}/${w.end}`;
    const seen = counts.get(key) ?? {
      weekday,
      start: w.start,
      end: w.end,
      count: 0,
    };
    seen.count += 1;
    counts.set(key, seen);
  }
  let best: { weekday: number; start: number; end: number } | undefined;
  let most = 0;
  for (const c of counts.values()) {
    if (c.count > most) {
      most = c.count;
      best = { weekday: c.weekday, start: c.start, end: c.end };
    }
  }
  return best;
}

/** A sensible "games per team" when the owner hasn't said: one per game day. */
export function defaultGamesPerTeam(
  windows: readonly PlanWindow[],
  gamesPerTeamPerDay: number,
  blackouts: ReadonlySet<string> = new Set(),
): number {
  const days = new Set(
    windows.filter((w) => !blackouts.has(w.date)).map((w) => w.date),
  ).size;
  return Math.max(1, Math.min(MAX_GAMES_PER_TEAM, days * gamesPerTeamPerDay));
}
