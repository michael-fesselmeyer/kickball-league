import type { StandingsRow } from "@/domain/standings/standings";

/**
 * League history: each season's champion and every team's all-time record,
 * built from the seasons' standings (src/domain/standings).
 *
 * Teams are plain string keys that stay the same from season to season (the
 * pages use the team's slug), not a season entry, so a record carries
 * across seasons.
 *
 * - A season's champion is its playoff bracket's winner when it had one,
 *   else the team on top of its final standings. Only a completed season
 *   has a champion, and a season nobody played has none.
 * - The all-time record adds up the regular-season standings of every season
 *   given, including one still being played. Titles count completed seasons
 *   only.
 *
 * Pure: no clock, no database.
 */

/** The standings columns the history reads. */
export type FinalRow = Pick<
  StandingsRow,
  | "teamId"
  | "rank"
  | "played"
  | "wins"
  | "losses"
  | "ties"
  | "runsFor"
  | "runsAgainst"
  | "runDifference"
>;

export type SeasonResult = {
  seasonId: string;
  completed: boolean;
  /** The season's standings in rank order, keyed by team. */
  rows: readonly FinalRow[];
  /** The playoff bracket's winner, when the season had a bracket. */
  bracketChampion?: string | null;
};

export type AllTimeRecord = {
  team: string;
  /** Seasons in which the team played at least one game. */
  seasons: number;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  /** A tie counts as half a win, as in the standings. */
  winPct: number;
  runsFor: number;
  runsAgainst: number;
  /** Capped at 10 a game, as in the standings. */
  runDifference: number;
  titles: number;
  /** The seasons the team won, in the order given. */
  titleSeasonIds: string[];
};

/** The season's champion, or null while it is not over or if nobody played. */
export function seasonChampion(season: SeasonResult): string | null {
  if (!season.completed) return null;
  if (season.bracketChampion) return season.bracketChampion;
  const [leader, next] = season.rows;
  if (!leader || leader.played === 0) return null;
  // Level at the top after every tiebreaker: no single champion.
  if (next && next.rank === leader.rank) return null;
  return leader.teamId;
}

const winPct = (wins: number, ties: number, played: number) =>
  played === 0 ? 0 : (wins + ties / 2) / played;

const empty = (team: string): AllTimeRecord => ({
  team,
  seasons: 0,
  played: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  winPct: 0,
  runsFor: 0,
  runsAgainst: 0,
  runDifference: 0,
  titles: 0,
  titleSeasonIds: [],
});

/**
 * Every team's all-time record across `seasons`: most titles first, then
 * win percentage, wins, run difference and name.
 */
export function allTimeRecords(
  seasons: readonly SeasonResult[],
): AllTimeRecord[] {
  const byTeam = new Map<string, AllTimeRecord>();
  const recordOf = (team: string) => {
    let found = byTeam.get(team);
    if (!found) {
      found = empty(team);
      byTeam.set(team, found);
    }
    return found;
  };
  for (const season of seasons) {
    for (const row of season.rows) {
      if (row.played === 0) continue;
      const r = recordOf(row.teamId);
      r.seasons++;
      r.played += row.played;
      r.wins += row.wins;
      r.losses += row.losses;
      r.ties += row.ties;
      r.runsFor += row.runsFor;
      r.runsAgainst += row.runsAgainst;
      r.runDifference += row.runDifference;
    }
    const champion = seasonChampion(season);
    if (champion) {
      const r = recordOf(champion);
      r.titles++;
      r.titleSeasonIds.push(season.seasonId);
    }
  }
  const records = [...byTeam.values()].map((r) => ({
    ...r,
    winPct: winPct(r.wins, r.ties, r.played),
  }));
  return records.sort(
    (a, b) =>
      b.titles - a.titles ||
      b.winPct - a.winPct ||
      b.wins - a.wins ||
      b.runDifference - a.runDifference ||
      a.team.localeCompare(b.team),
  );
}

/** One team's all-time record; all zeros if it never played. */
export function allTimeRecordOf(
  team: string,
  seasons: readonly SeasonResult[],
): AllTimeRecord {
  return allTimeRecords(seasons).find((r) => r.team === team) ?? empty(team);
}

/** "12-5-1": wins, losses, ties. */
export const recordLine = (
  r: Pick<AllTimeRecord, "wins" | "losses" | "ties">,
) => `${r.wins}-${r.losses}-${r.ties}`;

/** ".750"; a perfect record reads "1.000", as in the standings. */
export const pctText = (n: number) =>
  n === 1 ? "1.000" : n.toFixed(3).replace(/^0/, "");

/** "+4", "0", "-3". */
export const signedText = (n: number) => (n > 0 ? `+${n}` : String(n));

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: "UTC",
});

/** A season's dates, "Apr 6 – May 18, 2026", from calendar dates (YYYY-MM-DD). */
export function seasonDates(startsOn: string, endsOn: string): string {
  const start = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  const [startYear, endYear] = [
    YEAR_FORMAT.format(start),
    YEAR_FORMAT.format(end),
  ];
  return startYear === endYear
    ? `${DAY_FORMAT.format(start)} – ${DAY_FORMAT.format(end)}, ${endYear}`
    : `${DAY_FORMAT.format(start)}, ${startYear} – ${DAY_FORMAT.format(end)}, ${endYear}`;
}
