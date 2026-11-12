import { chronological, sideOf, type StatGame, winnerOf } from "./games";
import { runs } from "./streaks";

/**
 * League records across every season. When two marks are equal, the one
 * set first holds the record: it stands until someone beats it.
 *
 * Game records count played games only, since a forfeit has no runs.
 * Season records count each season's regular games, like the standings.
 */

export type RecordKey =
  | "most_runs"
  | "biggest_win"
  | "highest_scoring"
  | "longest_win_streak"
  | "longest_losing_streak"
  | "most_wins_season"
  | "most_shutouts_season";

export type LeagueRecord = {
  key: RecordKey;
  value: number;
  team: string | null;
  /** The other team, for game records. */
  opponent: string | null;
  seasonId: string;
  /** The game it was set in; for a streak, the game that ended at its peak. */
  gameId: string;
  playedAt: Date;
  /** Other marks equal to it, set later. */
  matchedBy: number;
};

type Candidate = Omit<LeagueRecord, "key" | "matchedBy">;

/** The best candidate, the earliest on a tie, with how many matched it. */
function best(
  key: RecordKey,
  candidates: readonly Candidate[],
): LeagueRecord | null {
  let top: Candidate | null = null;
  let matchedBy = 0;
  for (const c of candidates) {
    if (!top || c.value > top.value) {
      top = c;
      matchedBy = 0;
    } else if (c.value === top.value) matchedBy++;
  }
  return top && top.value > 0 ? { key, ...top, matchedBy } : null;
}

export function leagueRecords(games: readonly StatGame[]): LeagueRecord[] {
  const ordered = chronological(games);
  const played = ordered.flatMap((g) =>
    g.result.kind === "played" ? [{ game: g, ...g.result }] : [],
  );

  const mostRuns: Candidate[] = played.map(({ game, scoreA, scoreB }) => {
    const aHigher = scoreA >= scoreB;
    return {
      value: Math.max(scoreA, scoreB),
      team: aHigher ? game.teamA : game.teamB,
      opponent: aHigher ? game.teamB : game.teamA,
      seasonId: game.seasonId,
      gameId: game.id,
      playedAt: game.playedAt,
    };
  });
  const biggestWin: Candidate[] = played.flatMap(({ game, scoreA, scoreB }) => {
    const winner = winnerOf(game);
    if (winner === null) return [];
    return [
      {
        value: Math.abs(scoreA - scoreB),
        team: winner,
        opponent: winner === game.teamA ? game.teamB : game.teamA,
        seasonId: game.seasonId,
        gameId: game.id,
        playedAt: game.playedAt,
      },
    ];
  });
  const highestScoring: Candidate[] = played.map(
    ({ game, scoreA, scoreB }) => ({
      value: scoreA + scoreB,
      team: game.teamA,
      opponent: game.teamB,
      seasonId: game.seasonId,
      gameId: game.id,
      playedAt: game.playedAt,
    }),
  );

  // Season records: per team per season, regular games only.
  const winStreaks: Candidate[] = [];
  const lossStreaks: Candidate[] = [];
  const seasonWins: Candidate[] = [];
  const shutouts: Candidate[] = [];
  const regular = ordered.filter((g) => g.kind === "regular");
  const keys = new Set(
    regular.flatMap((g) => [
      `${g.seasonId}\u0000${g.teamA}`,
      `${g.seasonId}\u0000${g.teamB}`,
    ]),
  );
  for (const key of keys) {
    const [seasonId = "", team = ""] = key.split("\u0000");
    const sides = regular
      .filter(
        (g) =>
          g.seasonId === seasonId && (g.teamA === team || g.teamB === team),
      )
      .map((g) => sideOf(g, team));
    let index = 0;
    for (const run of runs(sides.map((s) => s.outcome))) {
      index += run.length;
      const end = sides[index - 1];
      if (!end) continue;
      const mark = {
        value: run.length,
        team,
        opponent: null,
        seasonId,
        gameId: end.game.id,
        playedAt: end.game.playedAt,
      };
      if (run.outcome === "W") winStreaks.push(mark);
      if (run.outcome === "L") lossStreaks.push(mark);
    }
    const last = sides.at(-1);
    if (!last) continue;
    const season = {
      team,
      opponent: null,
      seasonId,
      gameId: last.game.id,
      playedAt: last.game.playedAt,
    };
    seasonWins.push({
      ...season,
      value: sides.filter((s) => s.outcome === "W").length,
    });
    shutouts.push({
      ...season,
      value: sides.filter((s) => s.outcome === "W" && s.runsAgainst === 0)
        .length,
    });
  }
  // Streaks and season totals are compared in the order they were set.
  const bySet = (list: Candidate[]) =>
    [...list].sort(
      (a, b) =>
        a.playedAt.getTime() - b.playedAt.getTime() ||
        a.gameId.localeCompare(b.gameId),
    );

  return [
    best("most_runs", mostRuns),
    best("biggest_win", biggestWin),
    best("highest_scoring", highestScoring),
    best("longest_win_streak", bySet(winStreaks)),
    best("most_wins_season", bySet(seasonWins)),
    best("most_shutouts_season", bySet(shutouts)),
    best("longest_losing_streak", bySet(lossStreaks)),
  ].filter((r): r is LeagueRecord => r !== null);
}

export const RECORD_TITLES: Record<RecordKey, string> = {
  most_runs: "Most runs in a game",
  biggest_win: "Biggest win",
  highest_scoring: "Highest-scoring game",
  longest_win_streak: "Longest winning streak",
  most_wins_season: "Most wins in a season",
  most_shutouts_season: "Most shutouts in a season",
  longest_losing_streak: "Longest character-building stretch",
};

/** "14 runs", "by 11 runs", "3 shutouts": the value with its unit. */
export function recordValue(r: LeagueRecord): string {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  switch (r.key) {
    case "most_runs":
    case "highest_scoring":
      return plural(r.value, "run", "runs");
    case "biggest_win":
      return `By ${plural(r.value, "run", "runs")}`;
    case "longest_win_streak":
      return plural(r.value, "win in a row", "wins in a row");
    case "longest_losing_streak":
      return plural(r.value, "loss in a row", "losses in a row");
    case "most_wins_season":
      return plural(r.value, "win", "wins");
    case "most_shutouts_season":
      return plural(r.value, "shutout", "shutouts");
  }
}

/** The records first set in one of `gameIds`, for "new record" callouts. */
export function recordsSetIn(
  records: readonly LeagueRecord[],
  gameIds: ReadonlySet<string>,
): LeagueRecord[] {
  return records.filter((r) => gameIds.has(r.gameId));
}
