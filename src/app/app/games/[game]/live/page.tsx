import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LineScore } from "@/components/line-score";
import { db } from "@/db/client";
import { hasReferee, liveGame, snapshotOf } from "@/db/queries/live-scores";
import { gameForScoring } from "@/db/queries/scores";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { fullWhen } from "@/domain/schedule/format";
import {
  calledScore,
  lineScore,
  ordinal,
  positionLabel,
  sideFor,
} from "@/domain/scores/live";
import { MIN_CALLED_INNINGS, PLAYOFF_TIE } from "@/domain/scores/scores";
import { requirePermission } from "@/lib/auth/permission";
import {
  endGameAction,
  kicksFirstAction,
  saveHalfAction,
  undoAction,
} from "./actions";

export const metadata: Metadata = { title: "Live score" };

export default function LivePage(props: PageProps<"/app/games/[game]/live">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>Loading the game…</p>}>
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
  no_kicks_first: "Choose who kicks first.",
  no_innings: "Enter at least one inning first.",
  too_few_innings: `A game called before ${MIN_CALLED_INNINGS} complete innings doesn’t count. If the weather stopped it, tell an admin it’s a rain-out.`,
  playoff_tie: PLAYOFF_TIE,
  not_found: "That game is gone.",
};

/** Runs most halves end with, one tap each. */
const QUICK_RUNS = [0, 1, 2, 3, 4, 5, 6, 7];

async function Live({
  params,
  searchParams,
}: PageProps<"/app/games/[game]/live">) {
  const { game: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawId}/live`,
  });
  const gameId = parseId<GameId>(rawId);
  if (!gameId) notFound();
  const [g, live, refereed, league] = await Promise.all([
    gameForScoring(db, gameId),
    liveGame(db, gameId),
    hasReferee(db, gameId),
    currentLeague(db),
  ]);
  if (!g || !live) notFound();
  const ctx = {
    game: {
      id: g.id,
      teamSeasonIds: [g.teamAId, g.teamBId] as const,
      hasReferee: refereed,
    },
  };
  if (!can(subject, "score.live", ctx)) notFound();
  const tz = league?.timeZone ?? "America/New_York";
  const snapshot = snapshotOf(live);
  const names = { A: g.teamAName, B: g.teamBName } as const;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const scorePage = `/app/games/${g.id}/score`;

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
        <p className="text-small text-text-muted">
          Enter the runs after each half-inning. The{" "}
          <Link href={`/games/${g.id}`} className="underline">
            public game page
          </Link>{" "}
          shows them within 15 seconds.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
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
              <button
                key={side}
                type="submit"
                name="side"
                value={side}
                className="btn min-w-0 btn-primary"
              >
                <span className="truncate">{names[side]}</span>
              </button>
            ))}
          </div>
        </form>
      ) : (
        <Scoring
          g={g}
          kicksFirst={live.kicksFirst}
          snapshot={snapshot}
          names={names}
          scorePage={scorePage}
        />
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

function Scoring({
  g,
  kicksFirst,
  snapshot,
  names,
  scorePage,
}: {
  g: { id: GameId };
  kicksFirst: "A" | "B";
  snapshot: ReturnType<typeof snapshotOf>;
  names: { A: string; B: string };
  scorePage: string;
}) {
  const line = lineScore(snapshot.halves, kicksFirst);
  const called = calledScore(snapshot.halves, kicksFirst);
  const next = line.next;
  const last = line.last;
  const team = (side: "A" | "B") => names[side];

  return (
    <>
      {snapshot.reported && (
        <p role="status" className="rounded-lg border border-success p-3">
          A final score has been reported.{" "}
          <Link href={scorePage} className="underline">
            See it on the score screen
          </Link>
          .
        </p>
      )}

      <LineScore teamA={names.A} teamB={names.B} snapshot={snapshot} />

      {next && (
        <section
          aria-labelledby="next-half"
          className="flex flex-col gap-3 rounded-lg border-2 border-text p-4 shadow-sticker"
        >
          <div>
            <h2 id="next-half" className="text-h3">
              {positionLabel(next)}
            </h2>
            <p className="text-text-muted">
              {team(sideFor(next.half, kicksFirst))} kicking. How many runs?
            </p>
          </div>
          <form action={saveHalfAction.bind(null, g.id)}>
            <input type="hidden" name="inning" value={next.inning} />
            <input type="hidden" name="half" value={next.half} />
            <fieldset className="grid grid-cols-4 gap-2">
              <legend className="sr-only">
                Runs in the {positionLabel(next).toLowerCase()}
              </legend>
              {QUICK_RUNS.map((runs) => (
                <button
                  key={runs}
                  type="submit"
                  name="runs"
                  value={runs}
                  className="btn px-0 text-h3 btn-secondary tabular-nums"
                >
                  {runs}
                </button>
              ))}
            </fieldset>
          </form>
          <form
            action={saveHalfAction.bind(null, g.id)}
            className="flex items-end gap-2"
          >
            <input type="hidden" name="inning" value={next.inning} />
            <input type="hidden" name="half" value={next.half} />
            <label className="flex flex-col gap-1">
              More runs
              <input
                name="typedRuns"
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                required
                className="min-h-11 w-24 rounded-input border border-border-strong bg-surface px-3 text-center tabular-nums"
              />
            </label>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </form>
        </section>
      )}

      {last && (
        <section aria-labelledby="fix" className="flex flex-col gap-3">
          <h2 id="fix" className="text-h3">
            Fix a mistake
          </h2>
          <form action={undoAction.bind(null, g.id)}>
            <button type="submit" className="btn btn-secondary">
              Take back the {positionLabel(last).toLowerCase()}
            </button>
          </form>
          <details className="rounded-lg border border-border p-3">
            <summary className="min-h-11 content-center">
              Change the runs in an earlier half
            </summary>
            <form
              action={saveHalfAction.bind(null, g.id)}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1">
                Half-inning
                <select
                  name="position"
                  defaultValue={`${last.inning}:${last.half}`}
                  className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
                >
                  {snapshot.halves.map((h) => (
                    <option
                      key={`${h.inning}:${h.half}`}
                      value={`${h.inning}:${h.half}`}
                    >
                      {positionLabel(h)} ({team(sideFor(h.half, kicksFirst))}
                      ): {h.runs}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                Runs
                <input
                  name="typedRuns"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  required
                  className="min-h-11 w-20 rounded-input border border-border-strong bg-surface px-3 text-center tabular-nums"
                />
              </label>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </form>
          </details>
        </section>
      )}

      {last && (
        <section aria-labelledby="end" className="flex flex-col gap-3">
          <h2 id="end" className="text-h3">
            End the game
          </h2>
          <p className="text-small text-text-muted">
            This reports the final score. The captains confirm it on the score
            screen as usual.
          </p>
          <form
            action={endGameAction.bind(null, g.id, randomUUID())}
            className="flex flex-col gap-2"
          >
            <button
              type="submit"
              name="ending"
              value="normal"
              className="btn btn-primary"
            >
              Game over: {names.A} {line.totalA}, {names.B} {line.totalB}
            </button>
            {called ? (
              <button
                type="submit"
                name="ending"
                value="called"
                className="btn btn-secondary"
              >
                Called after the {ordinal(called.inningsPlayed)}: {names.A}{" "}
                {called.scoreA}, {names.B} {called.scoreB}
              </button>
            ) : (
              <p className="text-small text-text-muted">
                A game called before {MIN_CALLED_INNINGS} complete innings
                doesn’t count. If the weather stops it, tell an admin it’s a
                rain-out.
              </p>
            )}
          </form>
          {called && line.completeInnings * 2 < snapshot.halves.length && (
            <p className="text-small text-text-muted">
              A called game stands at the last complete inning, so the runs in
              the unfinished {ordinal(line.completeInnings + 1)} don’t count.
            </p>
          )}
        </section>
      )}

      <details className="rounded-lg border border-border p-3">
        <summary className="min-h-11 content-center">
          {team(kicksFirst)} kick first. Wrong team?
        </summary>
        <form
          action={kicksFirstAction.bind(null, g.id)}
          className="mt-3 flex flex-col gap-2"
        >
          <p className="text-small text-text-muted">
            Switching moves every top half to the other team.
          </p>
          <button
            type="submit"
            name="side"
            value={kicksFirst === "A" ? "B" : "A"}
            className="btn btn-secondary"
          >
            {team(kicksFirst === "A" ? "B" : "A")} kick first
          </button>
        </form>
      </details>
    </>
  );
}
