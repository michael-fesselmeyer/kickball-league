"use client";

import { useEffect, useState } from "react";
import {
  COMMAND_POLL_MS,
  type CommandGame,
  type CommandState,
  type RefState,
  type ScoreState,
} from "@/domain/gameday/command-center";
import { checkInForRefereeAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * The live part of the command center: the counts and every game. The
 * server renders it with the state it read, so the first paint is complete;
 * then, while the tab is visible, it asks the small JSON route for fresh
 * state every ten seconds and redraws. No realtime service: a few admins
 * polling cost one or two queries every ten seconds each.
 */
export function CommandBoard({
  initial,
  timeZone,
}: {
  initial: CommandState;
  timeZone: string;
}) {
  const [state, setState] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(
          `/app/admin/today/state.json?date=${initial.date}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(String(res.status));
        const next: CommandState | null = await res.json();
        if (!stopped && next) {
          setState(next);
          setStale(false);
        }
      } catch {
        if (!stopped) setStale(true);
      }
    };
    const timer = setInterval(refresh, COMMAND_POLL_MS);
    const onShow = () => void refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [initial.date]);

  const time = (iso: string, seconds = false) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      ...(seconds ? { second: "2-digit" } : {}),
      timeZone,
    }).format(new Date(iso));
  const { counts } = state;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Count label="Games" value={String(counts.games)} />
        <Count
          label="Refs at the field"
          value={`${counts.refsIn} of ${counts.refsAssigned}`}
          tone={counts.refsIn < counts.refsAssigned ? "warning" : "success"}
        />
        <Count label="Playing now" value={String(counts.live)} />
        <Count
          label="Scores missing"
          value={String(counts.missing)}
          tone={counts.missing > 0 ? "danger" : "success"}
        />
      </dl>
      <p className="text-small text-text-muted">
        {stale
          ? "Couldn't refresh. Showing what we had at "
          : "Updates every 10 seconds. Last checked "}
        {time(state.readAt, true)}.
      </p>
      {state.games.length === 0 ? (
        <p>No games on this day.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.games.map((g) => (
            <GameRow key={g.id} game={g} time={time} />
          ))}
        </ul>
      )}
    </div>
  );
}

type Tone = "success" | "warning" | "danger";
const DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
      <dt className="text-small text-text-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-h3 font-bold tabular-nums">
        {tone && (
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-full ${DOT[tone]}`}
          />
        )}
        {value}
      </dd>
    </div>
  );
}

const SCORE: Record<ScoreState, { label: string; tone?: Tone }> = {
  upcoming: { label: "Not started" },
  on: { label: "Playing, no runs entered yet" },
  live: { label: "Live" },
  reported: {
    label: "Score reported, waiting for the other captain",
    tone: "warning",
  },
  final: { label: "Final", tone: "success" },
  called_off: { label: "Called off" },
  missing: { label: "Score missing", tone: "danger" },
};

const REF: Record<RefState, { label: string; tone?: Tone }> = {
  none: { label: "No ref", tone: "danger" },
  waiting: { label: "not checked in yet" },
  late: { label: "not here yet", tone: "warning" },
  checked_in: { label: "at the field", tone: "success" },
};

function GameRow({
  game,
  time,
}: {
  game: CommandGame;
  time: (iso: string) => string;
}) {
  const score = SCORE[game.score];
  const ref = REF[game.referee.state];
  const needsCheckIn =
    game.referee.state === "waiting" || game.referee.state === "late";
  return (
    <li
      aria-label={`${game.teamA} vs ${game.teamB}`}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
    >
      <p className="flex flex-wrap justify-between gap-x-3 text-small text-text-muted">
        <span>
          {time(game.startsAt)} · {game.fieldName}
        </span>
        <span className="flex items-center gap-1.5">
          {score.tone && (
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${DOT[score.tone]}`}
            />
          )}
          {score.label}
          {game.inning && ` · ${game.inning}`}
        </span>
      </p>
      <p className="grid grid-cols-[1fr_auto] gap-x-3 font-bold">
        <span>{game.teamA}</span>
        <span className="tabular-nums">{game.runs?.a ?? ""}</span>
        <span>{game.teamB}</span>
        <span className="tabular-nums">{game.runs?.b ?? ""}</span>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-small">
        <span className="flex items-center gap-1.5">
          {ref.tone && (
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${DOT[ref.tone]}`}
            />
          )}
          {game.referee.state === "none"
            ? ref.label
            : `Ref ${game.referee.name}: ${ref.label}`}
        </span>
        {needsCheckIn && (
          <form action={checkInForRefereeAction}>
            <input type="hidden" name="gameId" value={game.id} />
            <SubmitButton className="min-h-11 underline">
              Mark here
              <span className="sr-only">
                : {game.referee.name} for {game.teamA} vs {game.teamB}
              </span>
            </SubmitButton>
          </form>
        )}
        <a
          href={`/app/games/${game.id}/score`}
          className="inline-flex min-h-11 items-center underline"
        >
          Score
          <span className="sr-only">
            {" "}
            {game.teamA} vs {game.teamB}
          </span>
        </a>
      </div>
    </li>
  );
}
