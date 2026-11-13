import { type StatGame, sideOf, winnerOf } from "@/domain/stats/games";
import { powerRankings } from "@/domain/stats/power";

/**
 * Suggestions for the team of the week: the game day's best wins. Beating a
 * team ranked above them counts most, then the size of the win. The admin
 * makes the call; this only puts the likely picks first.
 *
 * Teams are keys, as in the score stats. Pure: no clock, no database.
 */

export type Suggestion = {
  team: string;
  opponent: string;
  gameId: string;
  runsFor: number;
  runsAgainst: number;
  /** The opponent's power ranking going into the day, if it had one. */
  opponentRank: number | null;
  upset: boolean;
  score: number;
};

const UPSET_WEIGHT = 2;

export function suggestTeamsOfWeek(
  teams: readonly string[],
  season: readonly StatGame[],
  day: string,
  dayOf: (instant: Date) => string,
  limit = 3,
): Suggestion[] {
  const regular = season.filter((g) => g.kind === "regular");
  const before = powerRankings(
    teams,
    regular.filter((g) => dayOf(g.playedAt) < day),
  );
  const rankOf = new Map(before.map((r) => [r.team, r.rank]));
  const suggestions = regular
    .filter((g) => dayOf(g.playedAt) === day && g.result.kind === "played")
    .flatMap((g): Suggestion[] => {
      const winner = winnerOf(g);
      if (winner === null) return [];
      const side = sideOf(g, winner);
      if (side.runsFor === null || side.runsAgainst === null) return [];
      const mine = rankOf.get(winner);
      const theirs = rankOf.get(side.opponent);
      const climb =
        mine !== undefined && theirs !== undefined && theirs < mine
          ? mine - theirs
          : 0;
      return [
        {
          team: winner,
          opponent: side.opponent,
          gameId: g.id,
          runsFor: side.runsFor,
          runsAgainst: side.runsAgainst,
          opponentRank: theirs ?? null,
          upset: climb > 0,
          score: side.runsFor - side.runsAgainst + UPSET_WEIGHT * climb,
        },
      ];
    });
  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.runsFor - a.runsFor ||
        a.team.localeCompare(b.team),
    )
    .slice(0, limit);
}

/** A ready-made reason the admin can keep or rewrite. */
export function suggestionReason(s: Suggestion, opponentName: string): string {
  const score = `${s.runsFor}–${s.runsAgainst}`;
  if (s.upset && s.opponentRank !== null)
    return `Took down No. ${s.opponentRank} ${opponentName}, ${score}.`;
  if (s.runsFor - s.runsAgainst <= 1)
    return `Edged ${opponentName} ${score} in the day's tightest finish.`;
  return `Beat ${opponentName} ${score}.`;
}
