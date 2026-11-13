import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LineScore } from "@/components/line-score";
import { db } from "@/db/client";
import { hasReferee, liveGame, snapshotOf } from "@/db/queries/live-scores";
import { gameForScoring, scoreHistory } from "@/db/queries/scores";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { fullWhen } from "@/domain/schedule/format";
import { scoreVersion } from "@/domain/scores/offline";
import { MIN_CALLED_INNINGS, PLAYOFF_TIE } from "@/domain/scores/scores";
import { requirePermission } from "@/lib/auth/permission";
import { kicksFirstAction } from "./actions";
import { Scoring } from "./scoring";

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
  const [g, live, refereed, league, history] = await Promise.all([
    gameForScoring(db, gameId),
    liveGame(db, gameId),
    hasReferee(db, gameId),
    currentLeague(db),
    scoreHistory(db, gameId),
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
          gameId={g.id}
          userId={subject.userId}
          kicksFirst={live.kicksFirst}
          snapshot={snapshot}
          names={names}
          scorePage={scorePage}
          version={scoreVersion(history.reports, history.responses)}
          endKey={randomUUID()}
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
