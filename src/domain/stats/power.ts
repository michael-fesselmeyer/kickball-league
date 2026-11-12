import { RUN_DIFFERENCE_CAP } from "@/domain/standings/standings";
import {
  cappedDiff,
  type Outcome,
  sidesOf,
  type StatGame,
  winPct,
} from "./games";

/**
 * Power rankings: who is playing best right now, which the standings alone
 * do not say. Each part is between 0 and 1, and the score is their
 * weighted sum, so it is between 0 and 1 too.
 *
 * - record: win percentage, a tie counting as half a win.
 * - form: win percentage over the last FORM_GAMES games.
 * - margin: average run difference a game, capped like the standings,
 *   scaled from -cap..cap to 0..1. Forfeits have no runs and do not count;
 *   with no runs at all it is 0.5.
 * - schedule: the average record of the opponents faced, once per meeting.
 *
 * Only teams that have played rank. Equal scores are split by record, then
 * margin, then the team key, so every team gets its own rank.
 */

export const POWER_WEIGHTS = {
  record: 0.45,
  form: 0.25,
  margin: 0.2,
  schedule: 0.1,
} as const;

export const FORM_GAMES = 3;

export type PowerRow = {
  team: string;
  rank: number;
  /** 0 to 1. */
  score: number;
  played: number;
  record: number;
  form: number;
  margin: number;
  schedule: number;
};

export function powerRankings(
  teams: readonly string[],
  games: readonly StatGame[],
): PowerRow[] {
  const sides = new Map(teams.map((t) => [t, sidesOf(t, games)]));
  const recordOf = new Map<string, number>();
  const outcomesOf = (t: string): Outcome[] =>
    (sides.get(t) ?? []).map((s) => s.outcome);
  for (const t of teams) recordOf.set(t, winPct(outcomesOf(t)));
  // Opponents outside `teams` still have a record from these games.
  const opponentRecord = (t: string) =>
    recordOf.get(t) ?? winPct(sidesOf(t, games).map((s) => s.outcome));

  const rows = teams.flatMap((team) => {
    const mine = sides.get(team) ?? [];
    if (mine.length === 0) return [];
    const outcomes = mine.map((s) => s.outcome);
    const record = winPct(outcomes);
    const form = winPct(outcomes.slice(-FORM_GAMES));
    const diffs = mine.flatMap((s) => {
      const d = cappedDiff(s);
      return d === null ? [] : [d];
    });
    const margin =
      diffs.length === 0
        ? 0.5
        : (diffs.reduce((a, b) => a + b, 0) / diffs.length +
            RUN_DIFFERENCE_CAP) /
          (2 * RUN_DIFFERENCE_CAP);
    const schedule =
      mine.reduce((sum, s) => sum + opponentRecord(s.opponent), 0) /
      mine.length;
    const score =
      POWER_WEIGHTS.record * record +
      POWER_WEIGHTS.form * form +
      POWER_WEIGHTS.margin * margin +
      POWER_WEIGHTS.schedule * schedule;
    return [
      {
        team,
        rank: 0,
        score,
        played: mine.length,
        record,
        form,
        margin,
        schedule,
      },
    ];
  });
  rows.sort(
    (x, y) =>
      y.score - x.score ||
      y.record - x.record ||
      y.margin - x.margin ||
      x.team.localeCompare(y.team),
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export type RankedWithMovement = PowerRow & {
  /** Rank before the latest game day; null if the team had not played. */
  previousRank: number | null;
  /** Places gained since then (negative when it fell); null if new. */
  movement: number | null;
};

/**
 * The rankings now and how each team moved since before the latest game
 * day. `dayOf` turns a game's time into its local date.
 */
export function powerRankingsWithMovement(
  teams: readonly string[],
  games: readonly StatGame[],
  dayOf: (instant: Date) => string,
): RankedWithMovement[] {
  const now = powerRankings(teams, games);
  const days = games.map((g) => dayOf(g.playedAt)).sort();
  const latest = days.at(-1);
  const before =
    latest === undefined
      ? []
      : powerRankings(
          teams,
          games.filter((g) => dayOf(g.playedAt) < latest),
        );
  const previous = new Map(before.map((r) => [r.team, r.rank]));
  return now.map((r) => {
    const previousRank = previous.get(r.team) ?? null;
    return {
      ...r,
      previousRank,
      movement: previousRank === null ? null : previousRank - r.rank,
    };
  });
}

/** "▲2", "▼1", "–" or "New" for screen readers to have a word, see movementWords. */
export function movementLabel(movement: number | null): string {
  if (movement === null) return "New";
  if (movement > 0) return `▲${movement}`;
  if (movement < 0) return `▼${-movement}`;
  return "–";
}

/** "Up 2 places", "Down 1 place", "No change" or "New this week". */
export function movementWords(movement: number | null): string {
  if (movement === null) return "New this week";
  if (movement === 0) return "No change";
  const n = Math.abs(movement);
  return `${movement > 0 ? "Up" : "Down"} ${n} ${n === 1 ? "place" : "places"}`;
}
