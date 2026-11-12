import { dayHeading, fullWhen } from "@/domain/schedule/format";
import { localDay, type PublicGame } from "@/domain/schedule/public-game";
import { gameOfTheWeek, nextGameDay, pickBlurb } from "./game-of-the-week";
import type { StatGame } from "./games";
import { powerRankingsWithMovement } from "./power";
import { type Recap, weeklyRecap } from "./recap";
import { leagueRecords, recordsSetIn } from "./records";
import { matchupsFrom, statGamesFrom, teamsFrom } from "./season";
import { teamStreaks } from "./streaks";

/**
 * Puts the weekly recap draft together for one game day of a season, from
 * its published schedule and the league's history.
 */

/** The season's game days with a regular-season result, newest first. */
export function gameDays(
  schedule: readonly PublicGame[],
  timeZone: string,
): string[] {
  const days = statGamesFrom(schedule)
    .filter((g) => g.kind === "regular")
    .map((g) => localDay(g.playedAt, timeZone));
  return [...new Set(days)].sort().reverse();
}

export type DraftInput = {
  seasonName: string;
  schedule: readonly PublicGame[];
  /** Every finished game in the league, for records set on the day. */
  history: readonly StatGame[];
  /** YYYY-MM-DD in the league's time zone. */
  day: string;
  timeZone: string;
  /** The standings page, as an absolute URL. */
  link: string | null;
};

export function recapDraft(input: DraftInput): Recap {
  const dayOf = (d: Date) => localDay(d, input.timeZone);
  const season = statGamesFrom(input.schedule).filter(
    (g) => g.kind === "regular",
  );
  const throughDay = season.filter((g) => dayOf(g.playedAt) <= input.day);
  const onDay = season.filter((g) => dayOf(g.playedAt) === input.day);
  const teams = [...teamsFrom(input.schedule).keys()];
  const names = teamsFrom(input.schedule);
  const name = (slug: string) => names.get(slug)?.name ?? slug;
  const power = powerRankingsWithMovement(teams, throughDay, dayOf);

  // The game of the week for the next game day after this one.
  const after = new Date(
    Math.max(0, ...onDay.map((g) => g.playedAt.getTime())) + 1,
  );
  const week = nextGameDay(matchupsFrom(input.schedule), after, dayOf).filter(
    (m) => dayOf(m.startsAt) > input.day,
  );
  const pick = gameOfTheWeek(week, power, input.history);
  const picked = pick ? week.find((m) => m.gameId === pick.gameId) : undefined;
  const nextUp =
    pick && picked
      ? `${name(picked.teamA)} vs ${name(picked.teamB)}, ${fullWhen(picked.startsAt, input.timeZone)}. ${pickBlurb(pick.reason, name(picked.teamA), name(picked.teamB))}`
      : null;

  return weeklyRecap({
    seasonName: input.seasonName,
    dayLabel: dayHeading(input.day),
    games: onDay,
    name,
    power,
    streaks: teamStreaks(teams, throughDay),
    records: recordsSetIn(
      leagueRecords(input.history),
      new Set(onDay.map((g) => g.id)),
    ),
    nextUp,
    link: input.link,
  });
}
