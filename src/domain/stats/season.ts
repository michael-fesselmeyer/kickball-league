import {
  hasResult,
  isCalledOff,
  localDay,
  type PublicGame,
  type PublicTeam,
} from "@/domain/schedule/public-game";
import {
  gameOfTheWeek,
  type Matchup,
  nextGameDay,
  type Pick,
} from "./game-of-the-week";
import type { StatGame } from "./games";
import { powerRankingsWithMovement, type RankedWithMovement } from "./power";
import { teamStreaks, type TeamStreaks } from "./streaks";

/**
 * The score stats from the public schedule. Teams are keyed by their slug,
 * which stays the same from season to season, unlike a season entry.
 */

/** Finished games with a time, playoffs included; exhibitions left out. */
export function statGamesFrom(games: readonly PublicGame[]): StatGame[] {
  return games.flatMap((g): StatGame[] => {
    if (g.kind === "exhibition" || !hasResult(g) || g.startsAt === null)
      return [];
    const base = {
      id: g.id,
      seasonId: g.seasonId,
      kind: g.kind,
      playedAt: g.startsAt,
      teamA: g.teamA.slug,
      teamB: g.teamB.slug,
    };
    if (g.status === "forfeit")
      return [
        {
          ...base,
          result: {
            kind: "forfeit",
            forfeitBy: g.forfeitBy === g.teamA.id ? g.teamA.slug : g.teamB.slug,
          },
        },
      ];
    return [
      {
        ...base,
        result: {
          kind: "played",
          scoreA: g.scoreA ?? 0,
          scoreB: g.scoreB ?? 0,
        },
      },
    ];
  });
}

/** Games still to play: placed, not called off, without a result. */
export function matchupsFrom(games: readonly PublicGame[]): Matchup[] {
  return games.flatMap((g) =>
    g.kind === "exhibition" ||
    g.startsAt === null ||
    hasResult(g) ||
    isCalledOff(g)
      ? []
      : [
          {
            gameId: g.id,
            teamA: g.teamA.slug,
            teamB: g.teamB.slug,
            startsAt: g.startsAt,
          },
        ],
  );
}

/** Every team in the games, by slug. */
export function teamsFrom(
  games: readonly PublicGame[],
): Map<string, PublicTeam> {
  return new Map(
    games.flatMap((g) => [
      [g.teamA.slug, g.teamA],
      [g.teamB.slug, g.teamB],
    ]),
  );
}

export type SeasonStats = {
  /** The season's regular games, which the rankings and streaks count. */
  games: StatGame[];
  power: RankedWithMovement[];
  streaks: Map<string, TeamStreaks>;
  /** The next game day's game of the week, if there is one. */
  pick: Pick | null;
};

/**
 * One season's power rankings, streaks and game of the week. `history` is
 * every game the rivalry bonus may look at; it defaults to the season.
 */
export function seasonStats(
  schedule: readonly PublicGame[],
  teams: readonly string[],
  timeZone: string,
  now: Date,
  history?: readonly StatGame[],
): SeasonStats {
  const all = statGamesFrom(schedule);
  const games = all.filter((g) => g.kind === "regular");
  const dayOf = (d: Date) => localDay(d, timeZone);
  const power = powerRankingsWithMovement(teams, games, dayOf);
  const week = nextGameDay(matchupsFrom(schedule), now, dayOf);
  return {
    games,
    power,
    streaks: teamStreaks(teams, games),
    pick: gameOfTheWeek(week, power, history ?? all),
  };
}
