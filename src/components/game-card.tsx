import Link from "next/link";
import { LogoBadge } from "@/components/logo-badge";
import { gameMorph, Morph } from "@/components/motion";
import type { Hex } from "@/domain/color/contrast";
import { kickoff, shortDay } from "@/domain/schedule/format";
import {
  hasResult,
  isCalledOff,
  outcomeFor,
  type PublicGame,
  type PublicTeam,
  statusLabel,
} from "@/domain/schedule/public-game";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

type Props = {
  /** The league whose public pages the links open (ADR 0048). */
  league: LeagueRef;
  game: PublicGame;
  timeZone: string;
  /** Show the date as well as the time, for lists that span days. */
  showDay?: boolean;
  /** A team_season id to emphasize, such as the filtered team. */
  highlight?: string | null | undefined;
  /** Leave out the time and field, when a grid's headers already say them. */
  compact?: boolean;
  /** A short label on the card, such as "Crossover" for a game between divisions. */
  note?: string | undefined;
  /**
   * Grow into the game page's scoreboard on the way there. Turn it off for a
   * second card of the same game on one page, since a name is used once.
   */
  morph?: boolean;
  /** The page's language (ADR 0094); English unless given. */
  locale?: Locale;
  /** The running score while the game is being played, if it is known. */
  live?: { scoreA: number; scoreB: number } | null | undefined;
};

/** One game in a list: when, where, who, and the result. Opens the game page. */
export function GameCard({
  league,
  game,
  timeZone,
  showDay,
  highlight,
  compact,
  note,
  morph = true,
  locale = DEFAULT_LOCALE,
  live,
}: Props) {
  const done = hasResult(game);
  const calledOff = isCalledOff(game);
  const label = statusLabel(game, locale);
  const winner =
    outcomeFor(game, game.teamA.id) === "W"
      ? game.teamA.id
      : outcomeFor(game, game.teamB.id) === "W"
        ? game.teamB.id
        : null;
  const mine =
    highlight != null &&
    (game.teamA.id === highlight || game.teamB.id === highlight);

  const pill = label && (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-micro font-bold tracking-wide uppercase ${
        calledOff
          ? "border-danger text-danger"
          : game.status === "in_progress"
            ? "border-accent text-accent"
            : "border-border-strong text-text-muted"
      }`}
    >
      {label}
    </span>
  );
  // A final score, or the running score of a game being played.
  const running = game.status === "in_progress" ? (live ?? null) : null;
  const shown =
    done && game.status === "final"
      ? { scoreA: game.scoreA, scoreB: game.scoreB }
      : running;

  /*
   * A narrow card (a phone, or two cards side by side) puts the time,
   * field and status on one line above the teams, so the names get the
   * card's whole width; from 24rem the time sits beside them
   * (container query on the card itself, so the grid's columns count).
   */
  const card = (
    <Link
      href={linkIn(locale, leagueHref(league, `/games/${game.id}`))}
      className={`@container block min-h-11 rounded-card border bg-surface p-3 shadow-card hover:bg-surface-2 ${
        mine ? "border-2 border-brand" : "border-border"
      }`}
    >
      <span className="flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:gap-3">
        {(!compact || pill) && (
          <span
            className={`flex flex-wrap items-center gap-x-2 text-small @sm:w-24 @sm:shrink-0 @sm:flex-col @sm:flex-nowrap @sm:items-start ${compact ? "@sm:hidden" : ""}`}
          >
            {!compact &&
              (game.startsAt ? (
                <>
                  {showDay && (
                    <span>{shortDay(game.startsAt, timeZone, locale)}</span>
                  )}
                  <span className="font-bold tabular-nums">
                    {kickoff(game.startsAt, timeZone, locale)}
                  </span>
                </>
              ) : (
                <span className="font-bold">
                  {messagesFor(locale).schedule.timeTba}
                </span>
              ))}
            {!compact && game.field && (
              <span className="text-text-muted">{game.field}</span>
            )}
            {pill && <span className="ml-auto @sm:hidden">{pill}</span>}
          </span>
        )}
        <span
          className={`flex min-w-0 flex-1 flex-col gap-1 ${calledOff ? "line-through decoration-2" : ""}`}
        >
          <TeamLine
            team={game.teamA}
            score={shown ? shown.scoreA : null}
            won={winner === game.teamA.id}
            mine={game.teamA.id === highlight}
          />
          <TeamLine
            team={game.teamB}
            score={shown ? shown.scoreB : null}
            won={winner === game.teamB.id}
            mine={game.teamB.id === highlight}
          />
          {note && <span className="text-small text-text-muted">{note}</span>}
        </span>
        {pill && <span className="hidden @sm:flex">{pill}</span>}
      </span>
    </Link>
  );
  return morph ? <Morph name={gameMorph(game.id)}>{card}</Morph> : card;
}

function TeamLine({
  team,
  score,
  won,
  mine,
}: {
  team: PublicTeam;
  score: number | null;
  won: boolean;
  mine: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="flex">
        <LogoBadge
          kind="team"
          name={team.name}
          color={team.colorHex as Hex | null}
          size={24}
        />
      </span>
      <span
        className={`min-w-0 flex-1 break-words ${won || mine ? "font-bold" : ""}`}
      >
        {team.name}
      </span>
      {score !== null && (
        <span
          className={`font-display text-h3 tabular-nums ${won ? "font-extrabold" : "text-text-muted"}`}
        >
          {score}
        </span>
      )}
    </span>
  );
}
