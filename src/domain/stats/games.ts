/**
 * Finished games as the score stats read them: power rankings, streaks,
 * rivalries, the game of the week, league records and the weekly recap.
 *
 * Teams are plain string keys. The pages use the team's id, not its season
 * entry, so a rivalry or a record carries across seasons.
 *
 * Pure: no clock, no database.
 */

import { RUN_DIFFERENCE_CAP } from "@/domain/standings/standings";

export type StatResult =
  | { kind: "played"; scoreA: number; scoreB: number }
  | { kind: "forfeit"; forfeitBy: string };

export type StatGame = {
  id: string;
  seasonId: string;
  kind: "regular" | "playoff";
  /** When it was played; orders streaks and recent form. */
  playedAt: Date;
  teamA: string;
  teamB: string;
  result: StatResult;
};

export type Outcome = "W" | "L" | "T";

/** One game from one team's side. Forfeits have no runs. */
export type Side = {
  game: StatGame;
  team: string;
  opponent: string;
  outcome: Outcome;
  /** Null for a forfeit. */
  runsFor: number | null;
  runsAgainst: number | null;
};

/** Oldest first; games at the same moment by id, so the order is stable. */
export function chronological(games: readonly StatGame[]): StatGame[] {
  return [...games].sort(
    (x, y) =>
      x.playedAt.getTime() - y.playedAt.getTime() || x.id.localeCompare(y.id),
  );
}

export function involves(game: StatGame, team: string): boolean {
  return game.teamA === team || game.teamB === team;
}

/** The game from `team`'s side. The team must have played in it. */
export function sideOf(game: StatGame, team: string): Side {
  const isA = game.teamA === team;
  const opponent = isA ? game.teamB : game.teamA;
  if (game.result.kind === "forfeit")
    return {
      game,
      team,
      opponent,
      outcome: game.result.forfeitBy === team ? "L" : "W",
      runsFor: null,
      runsAgainst: null,
    };
  const mine = isA ? game.result.scoreA : game.result.scoreB;
  const theirs = isA ? game.result.scoreB : game.result.scoreA;
  return {
    game,
    team,
    opponent,
    outcome: mine > theirs ? "W" : mine < theirs ? "L" : "T",
    runsFor: mine,
    runsAgainst: theirs,
  };
}

/** A team's games from its side, oldest first. */
export function sidesOf(team: string, games: readonly StatGame[]): Side[] {
  return chronological(games.filter((g) => involves(g, team))).map((g) =>
    sideOf(g, team),
  );
}

/** Win percentage with a tie as half a win; 0 before any game. */
export function winPct(outcomes: readonly Outcome[]): number {
  if (outcomes.length === 0) return 0;
  const points = outcomes.reduce(
    (sum, o) => sum + (o === "W" ? 1 : o === "T" ? 0.5 : 0),
    0,
  );
  return points / outcomes.length;
}

/** The run difference of a played game, capped like the standings. */
export function cappedDiff(side: Side): number | null {
  if (side.runsFor === null || side.runsAgainst === null) return null;
  const diff = side.runsFor - side.runsAgainst;
  return Math.max(-RUN_DIFFERENCE_CAP, Math.min(RUN_DIFFERENCE_CAP, diff));
}

/** The winner of a game, or null for a tie. */
export function winnerOf(game: StatGame): string | null {
  const a = sideOf(game, game.teamA).outcome;
  return a === "W" ? game.teamA : a === "L" ? game.teamB : null;
}

/** A small, stable hash of a string, for picking copy variants. */
export function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
