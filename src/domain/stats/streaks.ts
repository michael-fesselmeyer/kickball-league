import { type Outcome, sidesOf, type StatGame } from "./games";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";

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
export function streakLabel(
  streak: Streak | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return streak
    ? `${messagesFor(locale).stats.outcome[streak.outcome]}${streak.length}`
    : "";
}

/**
 * Results written as one letter each ("WWLTW", "W3") in a language's own
 * letters: in Spanish, G, P and E.
 */
export function outcomeLetters(
  text: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const letters = messagesFor(locale).stats.outcome;
  return text.replace(/[WLT]/g, (c) => letters[c as Outcome]);
}

/** A line about a streak worth mentioning, or null for a quiet one. */
export function streakNote(
  name: string,
  streak: Streak | null,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (!streak || streak.length < 2) return null;
  const words = messagesFor(locale).stats;
  const n = streak.length;
  const say = (message: string) => fill(message, { name, n });
  if (streak.outcome === "W")
    return say(n >= 4 ? words.onFire : words.wonStraight);
  if (streak.outcome === "L")
    return say(n >= 4 ? words.droppedRow : words.lostStraight);
  return say(words.tiedRow);
}
