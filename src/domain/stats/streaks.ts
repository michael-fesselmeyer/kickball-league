import { type Outcome, sidesOf, type StatGame } from "./games";

/**
 * Win and loss streaks. A streak is the run of identical results ending
 * with the latest game; a tie ends a winning or losing streak and starts a
 * streak of ties.
 */

export type Streak = { outcome: Outcome; length: number };

export type TeamStreaks = {
  team: string;
  played: number;
  /** Null before the first game. */
  current: Streak | null;
  longestWin: number;
  longestLoss: number;
};

/** Every maximal run of identical results, oldest first. */
export function runs(outcomes: readonly Outcome[]): Streak[] {
  const result: Streak[] = [];
  for (const outcome of outcomes) {
    const last = result.at(-1);
    if (last && last.outcome === outcome) last.length++;
    else result.push({ outcome, length: 1 });
  }
  return result;
}

export function streaksOf(
  team: string,
  games: readonly StatGame[],
): TeamStreaks {
  const outcomes = sidesOf(team, games).map((s) => s.outcome);
  const all = runs(outcomes);
  const longest = (o: Outcome) =>
    Math.max(0, ...all.filter((r) => r.outcome === o).map((r) => r.length));
  return {
    team,
    played: outcomes.length,
    current: all.at(-1) ?? null,
    longestWin: longest("W"),
    longestLoss: longest("L"),
  };
}

export function teamStreaks(
  teams: readonly string[],
  games: readonly StatGame[],
): Map<string, TeamStreaks> {
  return new Map(teams.map((t) => [t, streaksOf(t, games)]));
}

/** "W3", the standings' shorthand; empty before any game. */
export function streakLabel(streak: Streak | null): string {
  return streak ? `${streak.outcome}${streak.length}` : "";
}

/** A line about a streak worth mentioning, or null for a quiet one. */
export function streakNote(name: string, streak: Streak | null): string | null {
  if (!streak || streak.length < 2) return null;
  const n = streak.length;
  if (streak.outcome === "W")
    return n >= 4
      ? `${name} are on fire: ${n} wins in a row.`
      : `${name} have won ${n} straight.`;
  if (streak.outcome === "L")
    return n >= 4
      ? `${name} have dropped ${n} in a row. The only way is up.`
      : `${name} have lost ${n} straight and are due.`;
  return `${name} have tied ${n} in a row. Remarkably balanced.`;
}
