import {
  defaultGamesPerTeam,
  MAX_GAME_MINUTES,
  MAX_GAMES_PER_TEAM,
  MAX_TEAMS,
  MIN_GAME_MINUTES,
  type ExtraRequest,
  type PlanWindow,
} from "@/domain/capacity/plan";

/**
 * The planner's choices, read from the screen's query string (an owners-only
 * screen, so it may), with defaults from the season.
 */

type Query = Record<string, string | string[] | undefined>;

const whole = (query: Query, name: string) => {
  const raw = query[name];
  const n = typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
  return Number.isInteger(n) ? n : null;
};

const within = (n: number | null, min: number, max: number) =>
  n !== null && n >= min && n <= max ? n : null;

export type PlanChoices = {
  gameMinutes: number;
  gamesPerTeam: number;
  wanted: number;
};

export function planChoices(
  query: Query,
  season: {
    windows: readonly PlanWindow[];
    blackouts: ReadonlySet<string>;
    gamesPerTeamPerDay: number;
    slotMinutes: number | null;
    entered: number;
    waiting: number;
  },
): PlanChoices {
  return {
    gameMinutes:
      within(whole(query, "minutes"), MIN_GAME_MINUTES, MAX_GAME_MINUTES) ??
      within(season.slotMinutes, MIN_GAME_MINUTES, MAX_GAME_MINUTES) ??
      60,
    gamesPerTeam:
      within(whole(query, "games"), 1, MAX_GAMES_PER_TEAM) ??
      defaultGamesPerTeam(
        season.windows,
        season.gamesPerTeamPerDay,
        season.blackouts,
      ),
    wanted:
      within(whole(query, "want"), 0, MAX_TEAMS) ??
      Math.min(MAX_TEAMS, season.entered + season.waiting),
  };
}

/** The request sheet, filled in with one option's extra field time. */
export function requestHref(slug: string, request: ExtraRequest): string {
  const params = new URLSearchParams({
    weekday: String(request.weekday),
    games: String(request.gamesPerDay),
    first: request.first,
    last: request.last,
    slot: String(request.slotMinutes),
  });
  if (request.fieldId) params.append("field", request.fieldId);
  return `/app/books/${slug}/permits?${params}#request`;
}
