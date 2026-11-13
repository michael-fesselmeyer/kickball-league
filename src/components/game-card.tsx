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

type Props = {
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
};

/** One game in a list: when, where, who, and the result. Opens the game page. */
export function GameCard({
  game,
  timeZone,
  showDay,
  highlight,
  compact,
  note,
  morph = true,
}: Props) {
  const done = hasResult(game);
  const calledOff = isCalledOff(game);
  const label = statusLabel(game);
  const winner =
    outcomeFor(game, game.teamA.id) === "W"
      ? game.teamA.id
      : outcomeFor(game, game.teamB.id) === "W"
        ? game.teamB.id
        : null;
  const mine =
    highlight != null &&
    (game.teamA.id === highlight || game.teamB.id === highlight);

  const card = (
    <Link
      href={`/games/${game.id}`}
      className={`flex min-h-11 items-center gap-3 rounded-card border bg-surface p-3 shadow-card hover:bg-surface-2 ${
        mine ? "border-2 border-brand" : "border-border"
      }`}
    >
      <span
        className={`w-24 shrink-0 flex-col text-small ${compact ? "hidden" : "flex"}`}
      >
        {game.startsAt ? (
          <>
            {showDay && <span>{shortDay(game.startsAt, timeZone)}</span>}
            <span className="font-bold tabular-nums">
              {kickoff(game.startsAt, timeZone)}
            </span>
          </>
        ) : (
          <span className="font-bold">Time TBA</span>
        )}
        {game.field && <span className="text-text-muted">{game.field}</span>}
      </span>
      <span
        className={`flex min-w-0 flex-1 flex-col gap-1 ${calledOff ? "line-through decoration-2" : ""}`}
      >
        <TeamLine
          team={game.teamA}
          score={done && game.status === "final" ? game.scoreA : null}
          won={winner === game.teamA.id}
          mine={game.teamA.id === highlight}
        />
        <TeamLine
          team={game.teamB}
          score={done && game.status === "final" ? game.scoreB : null}
          won={winner === game.teamB.id}
          mine={game.teamB.id === highlight}
        />
        {note && <span className="text-small text-text-muted">{note}</span>}
      </span>
      {label && (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-micro font-bold tracking-wide uppercase ${
            calledOff
              ? "border-danger text-danger"
              : label === "Live"
                ? "border-accent text-accent"
                : "border-border-strong text-text-muted"
          }`}
        >
          {label}
        </span>
      )}
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
