import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import {
  currentScoreState,
  gameForScoring,
  type ScoringGame,
  settleGame,
} from "@/db/queries/scores";
import { Pickups } from "@/components/pickups";
import { pickupsFor } from "@/db/queries/subs";
import { hasReferee } from "@/db/queries/live-scores";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { PLAYOFF_TIE, respondingTeams } from "@/domain/scores/scores";
import { requirePermission } from "@/lib/auth/permission";
import { teamRatingFor } from "@/db/queries/discipline";
import { canFileFor, canRate } from "@/domain/discipline/discipline";
import { featureEnabled } from "@/lib/platform/site";
import { respondAction, submitScoreAction } from "./actions";
import { rateSportsmanshipAction } from "./rate";
import { SportsmanshipForm } from "./sportsmanship-form";

export const metadata: Metadata = { title: "Score" };

export default function ScorePage(props: PageProps<"/app/games/[game]/score">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>Loading the game…</p>}>
        <Score {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  invalid:
    "Check the score: runs from 0 to 99, and 4 or more innings for a called game.",
  not_started: "This game has not started yet.",
  playoff_tie: PLAYOFF_TIE,
  already_final: "This score is final. Ask an admin to correct it.",
  not_yours: "Only the other team's captain can answer this score.",
  already_answered: "Your team has already answered this score.",
  unknown_report: "That score report is gone. Reload the page.",
  bad_score: "Pick a rating from 1 to 5.",
  rating_note_too_long: "Keep the note under 200 characters.",
  not_final: "You can rate the other team once the score is final.",
};

const input =
  "rounded-md border border-border bg-surface px-3 py-2 text-center text-h2 tabular-nums";

function ScoreForm({ g, label }: { g: ScoringGame; label: string }) {
  return (
    <form
      action={submitScoreAction.bind(null, g.id, randomUUID())}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["scoreA", g.teamAName],
            ["scoreB", g.teamBName],
          ] as const
        ).map(([name, team]) => (
          <label key={name} className="flex flex-col gap-1 text-center">
            <span className="truncate">{team}</span>
            <input
              name={name}
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              required
              className={input}
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        Result
        <select
          name="outcome"
          defaultValue="normal"
          className="rounded-md border border-border bg-surface px-2 py-2"
        >
          <option value="normal">Played to the end</option>
          <option value="called">Called early</option>
          <option value="forfeit_a">{g.teamAName} forfeited</option>
          <option value="forfeit_b">{g.teamBName} forfeited</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Complete innings, if called early
        <input
          name="inningsPlayed"
          type="number"
          inputMode="numeric"
          min={4}
          max={20}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1"
        />
        <span className="text-small text-text-muted">
          A called game counts after 4 complete innings, with the score at the
          last complete inning. For a forfeit, leave the runs at 0.
        </span>
      </label>
      <button type="submit" className="btn btn-primary">
        {label}
      </button>
    </form>
  );
}

/** "Mon, Sep 14, 8:00 PM" in the league's time zone. */
const whenIn = (timeZone: string) => (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);

async function Score({
  params,
  searchParams,
}: PageProps<"/app/games/[game]/score">) {
  const { game: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawId}/score`,
  });
  const gameId = parseId<GameId>(rawId);
  const found = gameId ? await gameForScoring(db, gameId) : null;
  if (!found) notFound();
  const now = new Date();
  // An undisputed score past its 24 hours is settled on the way in.
  await settleGame(db, found.id, now);
  const g = (await gameForScoring(db, found.id)) ?? found;
  const ctx = {
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] as const },
  };
  const mayEnter = can(subject, "score.enter", ctx);
  const mayScoreLive =
    g.status !== "final" &&
    g.status !== "forfeit" &&
    g.status !== "cancelled" &&
    (!g.startsAt || g.startsAt <= now) &&
    can(subject, "score.live", {
      game: { ...ctx.game, hasReferee: await hasReferee(db, g.id) },
    });
  const isAdmin = can(subject, "score.override", {});
  if (!mayEnter && !can(subject, "score.confirm", ctx)) notFound();
  const { state, history } = await currentScoreState(db, g, now);
  const latest = history.reports[0];
  const tz = (await currentLeague(db))?.timeZone ?? "America/New_York";
  const when = whenIn(tz);
  const myTeam = [g.teamAId, g.teamBId].find((t) =>
    subject.roster.some(
      (m) =>
        m.teamSeasonId === t &&
        (m.role === "captain" || m.role === "co_captain"),
    ),
  );
  const mayAnswer =
    latest !== undefined &&
    state.state === "awaiting" &&
    myTeam !== undefined &&
    respondingTeams(
      {
        id: latest.id,
        role: latest.role,
        teamSeasonId: latest.teamSeasonId,
        reportedAt: latest.reportedAt,
      },
      [g.teamAId, g.teamBId],
    ).includes(myTeam) &&
    !history.responses.some(
      (r) => r.reportId === latest.id && r.teamSeasonId === myTeam,
    );
  const shown = (r: NonNullable<typeof latest>) =>
    r.outcome === "forfeit_a"
      ? `${g.teamAName} forfeited`
      : r.outcome === "forfeit_b"
        ? `${g.teamBName} forfeited`
        : `${g.teamAName} ${r.scoreA}, ${g.teamBName} ${r.scoreB}${r.outcome === "called" ? ` (called after ${r.inningsPlayed} innings)` : ""}`;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const pickups = can(subject, "sub_request.view_pickups", ctx)
    ? (await pickupsFor(db, [g.id])).get(g.id)
    : undefined;
  // Game-day discipline: a captain rates the other team once the score is
  // final; the ref, a captain or an admin can report an incident.
  const discipline = await featureEnabled("discipline");
  const rates =
    discipline &&
    myTeam !== undefined &&
    canRate(g) &&
    can(subject, "sportsmanship.rate", ctx);
  const myRating = rates ? await teamRatingFor(db, g.id, myTeam) : null;
  const reports =
    discipline && canFileFor(g, now).ok && can(subject, "incident.log", ctx);

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {g.seasonName}
          {g.startsAt && ` · ${when(g.startsAt)}`}
          {g.fieldName && ` · ${g.fieldName}`}
        </p>
        <h1 className="text-h2">
          {g.teamAName} vs {g.teamBName}
        </h1>
        <Pickups
          pickups={pickups}
          teams={[
            { id: g.teamAId, name: g.teamAName },
            { id: g.teamBId, name: g.teamBName },
          ]}
        />
        <Link
          href={`/app/games/${g.id}/lineup`}
          className="self-start text-small underline"
        >
          Kicking orders
        </Link>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {(query.saved || query.confirmed || query.disputed) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.confirmed
            ? "Confirmed. The score is final."
            : query.disputed
              ? "Disputed. An admin will sort it out."
              : "Score saved."}
        </p>
      )}

      {state.state === "final" && (
        <section
          aria-label="Final score"
          className="rounded-lg border border-border p-4"
        >
          <p className="text-small text-text-muted">Final</p>
          <p className="text-h3">{latest ? shown(latest) : "Final"}</p>
        </section>
      )}
      {state.state === "awaiting" && latest && (
        <section
          aria-label="Reported score"
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
        >
          <p className="text-small text-text-muted">
            Reported by {latest.reporterName}
          </p>
          <p className="text-h3">{shown(latest)}</p>
          <p className="text-small text-text-muted">
            Final when{" "}
            {latest.role === "referee"
              ? "either captain confirms"
              : "the other team confirms"}
            , or on {when(state.finalAt)} if nobody disputes it.
          </p>
          {mayAnswer && (
            <form
              action={respondAction.bind(null, g.id, latest.id)}
              className="flex flex-col gap-2"
            >
              <label className="flex flex-col gap-1">
                Note, if you dispute it
                <input
                  name="note"
                  maxLength={300}
                  className="rounded-md border border-border bg-surface px-2 py-1"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  name="status"
                  value="confirmed"
                  className="btn btn-primary"
                >
                  Confirm
                </button>
                <button
                  type="submit"
                  name="status"
                  value="disputed"
                  className="btn btn-secondary"
                >
                  Dispute
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      {state.state === "disputed" && latest && (
        <section
          aria-label="Disputed score"
          className="flex flex-col gap-1 rounded-lg border border-warning p-4"
        >
          <p className="text-small text-text-muted">Disputed</p>
          <p className="text-h3">{shown(latest)}</p>
          {history.responses
            .filter((r) => r.reportId === latest.id && r.note)
            .map((r) => (
              <p key={r.teamSeasonId} className="text-small">
                “{r.note}”
              </p>
            ))}
          <p className="text-small text-text-muted">
            An admin will set the final score.
          </p>
        </section>
      )}

      {mayScoreLive && state.state === "none" && (
        <Link href={`/app/games/${g.id}/live`} className="btn btn-primary">
          Score it inning by inning
        </Link>
      )}

      {mayEnter &&
        (state.state === "none" ? (
          <ScoreForm g={g} label="Save the score" />
        ) : state.state !== "final" || isAdmin ? (
          <details className="rounded-lg border border-border p-3">
            <summary>
              {isAdmin
                ? "Set the score as an admin"
                : "Report a different score"}
            </summary>
            <div className="mt-3">
              <ScoreForm
                g={g}
                label={isAdmin ? "Save as the final score" : "Save the score"}
              />
            </div>
          </details>
        ) : null)}

      {query.rated && (
        <p role="status" className="rounded-lg border border-success p-3">
          Thanks. Your rating is saved.
        </p>
      )}
      {rates && (
        <SportsmanshipForm
          action={rateSportsmanshipAction.bind(null, g.id)}
          opponent={myTeam === g.teamAId ? g.teamBName : g.teamAName}
          current={myRating}
        />
      )}
      {reports && (
        <Link href={`/app/games/${g.id}/incident`} className="underline">
          Report an incident
        </Link>
      )}

      {history.reports.length > 1 && (
        <section aria-labelledby="history" className="flex flex-col gap-1">
          <h2 id="history" className="text-h3">
            History
          </h2>
          <ul className="text-small text-text-muted">
            {history.reports.map((r) => (
              <li key={r.id}>
                {when(r.reportedAt)}: {r.reporterName} reported {shown(r)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link href={`/seasons/${g.seasonSlug}/standings`} className="underline">
        Standings
      </Link>
    </>
  );
}
