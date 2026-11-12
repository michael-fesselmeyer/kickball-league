import {
  chronological,
  involves,
  sideOf,
  type StatGame,
  winnerOf,
} from "./games";

/**
 * The history between two teams, across every season: the series record,
 * runs, the last meeting, who has won the latest meetings and the biggest
 * win.
 */

export type Meeting = {
  gameId: string;
  playedAt: Date;
  /** Null for a tie. */
  winner: string | null;
  /** Runs for x and y; null for a forfeit. */
  runsX: number | null;
  runsY: number | null;
};

export type Rivalry = {
  x: string;
  y: string;
  meetings: number;
  winsX: number;
  winsY: number;
  ties: number;
  runsX: number;
  runsY: number;
  /** Newest first. */
  history: Meeting[];
  /** Who won the latest meetings in a row; null with none, or after a tie. */
  streak: { team: string; length: number } | null;
  biggestWin: { team: string; margin: number; gameId: string } | null;
};

const between = (game: StatGame, x: string, y: string) =>
  x !== y && involves(game, x) && involves(game, y);

export function rivalry(
  x: string,
  y: string,
  games: readonly StatGame[],
): Rivalry {
  const played = chronological(games.filter((g) => between(g, x, y)));
  const result: Rivalry = {
    x,
    y,
    meetings: played.length,
    winsX: 0,
    winsY: 0,
    ties: 0,
    runsX: 0,
    runsY: 0,
    history: [],
    streak: null,
    biggestWin: null,
  };
  for (const game of played) {
    const side = sideOf(game, x);
    const winner = winnerOf(game);
    if (winner === x) result.winsX++;
    else if (winner === y) result.winsY++;
    else result.ties++;
    result.runsX += side.runsFor ?? 0;
    result.runsY += side.runsAgainst ?? 0;
    result.history.unshift({
      gameId: game.id,
      playedAt: game.playedAt,
      winner,
      runsX: side.runsFor,
      runsY: side.runsAgainst,
    });
    if (winner !== null && side.runsFor !== null && side.runsAgainst !== null) {
      const margin = Math.abs(side.runsFor - side.runsAgainst);
      // The earliest stands until it is beaten.
      if (!result.biggestWin || margin > result.biggestWin.margin)
        result.biggestWin = { team: winner, margin, gameId: game.id };
    }
  }
  const latest = result.history[0]?.winner;
  if (latest) {
    let length = 0;
    while (result.history[length]?.winner === latest) length++;
    result.streak = { team: latest, length };
  }
  return result;
}

/** Every opponent a team has met, most meetings first, then by name key. */
export function rivalriesOf(
  team: string,
  games: readonly StatGame[],
): Rivalry[] {
  const opponents = new Set(
    games
      .filter((g) => involves(g, team) && g.teamA !== g.teamB)
      .map((g) => (g.teamA === team ? g.teamB : g.teamA)),
  );
  return [...opponents]
    .map((o) => rivalry(team, o, games))
    .sort((a, b) => b.meetings - a.meetings || a.y.localeCompare(b.y));
}

/**
 * "First meeting", "Series tied 2–2", "Kickers lead the series 3–1" or
 * "Kickers lead the series 3–1–1", the last number being ties.
 */
export function seriesLine(r: Rivalry, name: (team: string) => string) {
  if (r.meetings === 0) return "First meeting";
  const ties = r.ties > 0 ? `–${r.ties}` : "";
  if (r.winsX === r.winsY) return `Series tied ${r.winsX}–${r.winsY}${ties}`;
  const [leader, high, low] =
    r.winsX > r.winsY ? [r.x, r.winsX, r.winsY] : [r.y, r.winsY, r.winsX];
  return `${name(leader)} lead the series ${high}–${low}${ties}`;
}
