import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { LineScore } from "@/components/line-score";
import { db } from "@/db/client";
import { hasReferee, liveGame, snapshotOf } from "@/db/queries/live-scores";
import {
  delayedStarts,
  gameLimitsFor,
  permitInfoFor,
} from "@/db/queries/permit-watch";
import { startOf } from "@/db/queries/game-start";
import { GameClock, type GameClockProps } from "@/components/game-clock";
import {
  type HeldUpBy,
  isLateStart,
  minutesLate,
} from "@/domain/gameday/daylight";
import { gameForScoring, scoreHistory } from "@/db/queries/scores";
import { sportRules } from "@/domain/sports/sports";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { fullWhen, kickoff } from "@/domain/schedule/format";
import { scoreVersion } from "@/domain/scores/offline";
import { MIN_CALLED_INNINGS, PLAYOFF_TIE } from "@/domain/scores/scores";
import { requirePermission } from "@/lib/auth/permission";
import {
  heldUpAction,
  kicksFirstAction,
  startAction,
  undoStartAction,
} from "./actions";
import { EJECT_ERRORS, EjectSection } from "./eject";
import { featureEnabled } from "@/lib/platform/site";
import { Scoring } from "./scoring";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeague } from "@/lib/league/active";
import { LeagueLink } from "@/components/league-link";

export const metadata: Metadata = { title: "Live score" };

export default function LivePage(
  props: PageProps<"/[lang]/app/games/[game]/live">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading the game…</PageLoading>}>
        <Live {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  invalid: "Enter runs from 0 to 99.",
  out_of_order:
    "That half was not next. Someone else may have saved it first; here is the latest.",
  too_many_runs: "A team can’t have more than 99 runs in a game.",
  not_started: "This game hasn’t started yet.",
  already_final: "This game is final. Ask an admin to correct it.",
  reason_needed:
    "This game already has a score. To change it, set the score from the score page, with a reason.",
  no_kicks_first: "Choose who kicks first.",
  no_innings: "Enter at least one inning first.",
  too_few_innings: `A game called before ${MIN_CALLED_INNINGS} complete innings doesn’t count. If the weather stopped it, tell an admin it’s a rain-out.`,
  playoff_tie: PLAYOFF_TIE,
  not_found: "That game is gone.",
  ...EJECT_ERRORS,
  start_too_early:
    "First pitch can be recorded from 30 minutes before the game’s time.",
  start_closed: "This game is over, so its start can’t change.",
  start_not_started: "Record first pitch first.",
  start_not_found: "That game has no time slot, so it has no start to record.",
};

async function Live({
  params,
  searchParams,
}: PageProps<"/[lang]/app/games/[game]/live">) {
  const { game: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawId}/live`,
  });
  const gameId = parseId<GameId>(rawId);
  if (!gameId) notFound();
  const [
    g,
    live,
    refereed,
    league,
    history,
    permits,
    limits,
    discipline,
    delays,
    start,
  ] = await Promise.all([
    gameForScoring(db, gameId),
    liveGame(db, gameId),
    hasReferee(db, gameId),
    activeLeague(),
    scoreHistory(db, gameId),
    permitInfoFor(db, [gameId]),
    gameLimitsFor(db, gameId),
    featureEnabled("discipline"),
    delayedStarts(db, [gameId]),
    startOf(db, gameId),
  ]);
  // Live scoring counts half-innings: only a sport that has it (ADR 0087).
  if (!g || !live || !sportRules(g.sport).score.liveScoring) notFound();
  const ctx = {
    game: {
      id: g.id,
      teamSeasonIds: [g.teamAId, g.teamBId] as const,
      hasReferee: refereed,
    },
  };
  if (!can(subject, "score.live", ctx)) notFound();
  // Only the game's ref (or an admin) ejects a player, while it's in play.
  const mayEject = discipline && can(subject, "player.eject", ctx);
  const tz = league?.timeZone ?? "America/New_York";
  const snapshot = snapshotOf(live);
  const names = { A: g.teamAName, B: g.teamBName } as const;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const scorePage = `/app/games/${g.id}/score`;
  // When play must end, saved with the game; the screen counts down from it
  // on the phone's own clock, so it keeps working with no signal. The time
  // limit runs from the scheduled start, or a delayed day's new start, as
  // the game clock does: every minute late comes off the game.
  const info = permits.get(g.id);
  const permit = info
    ? {
        permitEndsAt: info.end.endsAt.toISOString(),
        endReason: info.end.reason,
        startsAt: info.clockStartsAt.toISOString(),
        timeLimitMinutes: info.timeLimitMinutes,
        innings: info.innings,
        rule: info.rule,
      }
    : null;
  // The game clock runs from the scheduled start on the phone's own clock,
  // or from the new start when the day's status delays the game.
  const clockStart = delays.get(g.id) ?? g.startsAt;
  const clock = clockStart
    ? { startsAt: clockStart.toISOString(), limits }
    : null;
  // When play must end (#467), from the field's permit or sunset.
  const endClock: GameClockProps | null =
    info && !info.dayOff
      ? {
          firstPitchAt: info.clockStartsAt.toISOString(),
          startedAt: start?.startedAt.toISOString() ?? null,
          endsAt: info.end.endsAt.toISOString(),
          endReason: info.end.reason,
          endLabel: kickoff(info.end.endsAt, tz),
          sunsetLabel: info.sunsetAt ? kickoff(info.sunsetAt, tz) : null,
        }
      : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {g.seasonName}
          {g.startsAt && ` · ${fullWhen(g.startsAt, tz)}`}
          {g.fieldName && ` · ${g.fieldName}`}
        </p>
        <h1 className="text-h2">
          {g.teamAName} vs {g.teamBName}
        </h1>
        <HelpLink audience="ref" article="live-scoring" topic="live scoring" />
        <p className="text-small text-text-muted">
          Enter the runs after each half-inning. The{" "}
          <LeagueLink href={`/games/${g.id}`} className="underline">
            public game page
          </LeagueLink>{" "}
          shows them within 15 seconds.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      {!snapshot.closed && endClock && <GameClock clock={endClock} />}
      {!snapshot.closed && g.startsAt && (
        <StartPanel
          gameId={g.id}
          firstPitchAt={info?.clockStartsAt ?? delays.get(g.id) ?? g.startsAt}
          start={start}
          names={names}
          tz={tz}
        />
      )}

      {snapshot.closed ? (
        <section aria-label="Final" className="flex flex-col gap-3">
          <p>This game is over, so its innings are locked.</p>
          <LineScore
            teamA={g.teamAName}
            teamB={g.teamBName}
            snapshot={snapshot}
          />
          <Link href={scorePage} className="btn self-start btn-secondary">
            See the final score
          </Link>
        </section>
      ) : !live.kicksFirst ? (
        <form
          action={kicksFirstAction.bind(null, g.id)}
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
        >
          <h2 className="text-h3">Who kicks first?</h2>
          <p className="text-small text-text-muted">
            They kick in the top of every inning.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(["A", "B"] as const).map((side) => (
              <SubmitButton
                key={side}
                name="side"
                value={side}
                className="btn min-w-0 btn-primary"
              >
                <span className="truncate">{names[side]}</span>
              </SubmitButton>
            ))}
          </div>
        </form>
      ) : (
        <Scoring
          gameId={g.id}
          userId={subject.userId}
          kicksFirst={live.kicksFirst}
          snapshot={snapshot}
          names={names}
          scorePage={scorePage}
          version={scoreVersion(history.reports, history.responses)}
          endKey={randomUUID()}
          permit={permit}
          clock={clock}
          endOfPlay={
            endClock
              ? { endsAt: endClock.endsAt, endReason: endClock.endReason }
              : null
          }
        />
      )}

      {mayEject && !snapshot.closed && (
        <EjectSection game={g} ejectedNotice={query.notice === "ejected"} />
      )}

      <Link
        href={scorePage}
        className="inline-flex min-h-11 items-center self-start underline"
      >
        Report or confirm the final score instead
      </Link>
    </>
  );
}

const HELD_UP_LABEL = (names: { A: string; B: string }) =>
  ({
    team_a: `${names.A} weren’t ready`,
    team_b: `${names.B} weren’t ready`,
    both: "Neither team was ready",
    neither: "Not the teams: the field, the ref or the weather",
  }) satisfies Record<HeldUpBy, string>;

/**
 * First pitch with one tap (issue #467): the clock counts down from it, and
 * a late start asks who held it up, for the admins' punctuality log.
 */
function StartPanel({
  gameId,
  firstPitchAt,
  start,
  names,
  tz,
}: {
  gameId: string;
  firstPitchAt: Date;
  start: { startedAt: Date; heldUpBy: HeldUpBy | null } | null;
  names: { A: string; B: string };
  tz: string;
}) {
  if (!start)
    return (
      <form
        action={startAction.bind(null, gameId)}
        className="flex flex-col gap-2"
      >
        <SubmitButton className="btn btn-primary">
          First pitch: start the clock
        </SubmitButton>
        <p className="text-small text-text-muted">
          Tap when the first pitch is thrown. Due at {kickoff(firstPitchAt, tz)}
          .
        </p>
      </form>
    );
  const late = minutesLate(firstPitchAt, start.startedAt);
  const labels = HELD_UP_LABEL(names);
  return (
    <section aria-labelledby="first-pitch" className="flex flex-col gap-2">
      <h2 id="first-pitch" className="text-h3">
        First pitch at {kickoff(start.startedAt, tz)}
      </h2>
      <p className="text-small text-text-muted">
        {late === 0
          ? "On time."
          : `${late} minute${late === 1 ? "" : "s"} after the scheduled ${kickoff(firstPitchAt, tz)}.`}
        {start.heldUpBy && ` ${labels[start.heldUpBy]}.`}
      </p>
      {isLateStart(firstPitchAt, start.startedAt) && !start.heldUpBy && (
        <form
          action={heldUpAction.bind(null, gameId)}
          className="flex flex-col gap-2 rounded-lg border border-warning p-3"
        >
          <p className="font-bold">Who held up the start?</p>
          {(Object.keys(labels) as HeldUpBy[]).map((key) => (
            <SubmitButton
              key={key}
              name="heldUpBy"
              value={key}
              className="btn btn-secondary"
            >
              {labels[key]}
            </SubmitButton>
          ))}
        </form>
      )}
      <details className="text-small">
        <summary className="min-h-11 content-center">
          Tapped first pitch by mistake?
        </summary>
        <form action={undoStartAction.bind(null, gameId)} className="mt-2">
          <SubmitButton className="btn btn-secondary">
            Undo first pitch
          </SubmitButton>
        </form>
      </details>
    </section>
  );
}
