import type { StatGame } from "./games";
import type { PowerRow } from "./power";
import { rivalry } from "./rivalry";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";

/**
 * The game of the week: the most promising matchup among the next game
 * day's games. Good teams that are close in the power rankings make the
 * best game; a close series or a tight last meeting adds a little.
 */

export type Matchup = {
  gameId: string;
  teamA: string;
  teamB: string;
  startsAt: Date;
};

export type PickReason =
  "top_clash" | "close_rematch" | "evenly_matched" | "best_available";

export type Pick = { gameId: string; reason: PickReason; score: number };

/** A team that has not played yet counts as middle of the pack. */
const UNRANKED_SCORE = 0.5;
const TIGHT_MARGIN = 2;

export function gameOfTheWeek(
  matchups: readonly Matchup[],
  power: readonly PowerRow[],
  history: readonly StatGame[],
): Pick | null {
  const byTeam = new Map(power.map((r) => [r.team, r]));
  const scoreOf = (t: string) => byTeam.get(t)?.score ?? UNRANKED_SCORE;
  const rankOf = (t: string) => byTeam.get(t)?.rank ?? Infinity;
  const picks = matchups.map((m): Pick & { startsAt: Date } => {
    const a = scoreOf(m.teamA);
    const b = scoreOf(m.teamB);
    const series = rivalry(m.teamA, m.teamB, history);
    const last = series.history[0];
    const tightLast =
      last !== undefined &&
      last.runsX !== null &&
      last.runsY !== null &&
      Math.abs(last.runsX - last.runsY) <= TIGHT_MARGIN;
    const closeSeries =
      series.meetings > 0 && Math.abs(series.winsX - series.winsY) <= 1;
    const bonus = (tightLast ? 0.06 : 0) + (closeSeries ? 0.04 : 0);
    const closeness = 1 - Math.abs(a - b);
    const score = 0.5 * ((a + b) / 2) + 0.4 * closeness + bonus;
    const reason: PickReason =
      rankOf(m.teamA) <= 3 && rankOf(m.teamB) <= 3
        ? "top_clash"
        : tightLast
          ? "close_rematch"
          : closeness >= 0.95
            ? "evenly_matched"
            : "best_available";
    return { gameId: m.gameId, reason, score, startsAt: m.startsAt };
  });
  picks.sort(
    (x, y) =>
      y.score - x.score ||
      x.startsAt.getTime() - y.startsAt.getTime() ||
      x.gameId.localeCompare(y.gameId),
  );
  const best = picks[0];
  return best
    ? { gameId: best.gameId, reason: best.reason, score: best.score }
    : null;
}

/** Why this game, in a sentence. */
export function pickBlurb(
  reason: PickReason,
  a: string,
  b: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return fill(messagesFor(locale).stats.blurb[reason], { a, b });
}

/** The next game day's matchups: every game on the earliest day after `now`. */
export function nextGameDay(
  matchups: readonly Matchup[],
  now: Date,
  dayOf: (instant: Date) => string,
): Matchup[] {
  const upcoming = matchups.filter((m) => m.startsAt > now);
  const first = upcoming
    .map((m) => dayOf(m.startsAt))
    .sort()
    .at(0);
  return first === undefined
    ? []
    : upcoming.filter((m) => dayOf(m.startsAt) === first);
}
