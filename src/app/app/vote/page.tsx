import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { type Ballot, votingPage } from "@/db/queries/awards";
import { CATEGORIES, type Nominee } from "@/domain/awards/awards";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { castVoteAction } from "./actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Vote for awards" };

export default function VotePage(props: PageProps<"/app/vote">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the ballots…</PageLoading>}>
        <Vote {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  not_open: "Voting has closed for that award.",
  not_on_roster: "Voting is for players on a team this season.",
  not_a_nominee: "Pick someone from the list.",
  self_vote: "Nice try! Pick someone other than yourself.",
  own_team: "Pick another team: your own can't get your vote.",
  already_voted: "You've already voted for that award.",
  not_found: "That poll is gone.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

const closesAt = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);

/**
 * The ballot's choices, grouped by team for player awards. Nobody can pick
 * themselves, or their own team for a team award.
 */
function Choices({ ballot, me }: { ballot: Ballot; me: string }) {
  const kind = CATEGORIES[ballot.poll.category].nominee;
  const choices = ballot.nominees.filter(
    (n) => n.id !== me && n.id !== ballot.myTeamSeasonId,
  );
  if (kind === "team")
    return choices.map((n) => (
      <option key={n.id} value={n.id}>
        {n.name}
      </option>
    ));
  const teams = new Map<string, Nominee[]>();
  for (const n of choices)
    teams.set(n.teamName, [...(teams.get(n.teamName) ?? []), n]);
  return [...teams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([team, players]) => (
      <optgroup key={team} label={team}>
        {players.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </optgroup>
    ));
}

function BallotCard({
  ballot,
  me,
  justVoted,
}: {
  ballot: Ballot;
  me: string;
  justVoted: boolean;
}) {
  const { poll } = ballot;
  const award = CATEGORIES[poll.category];
  const pick = ballot.nominees.find((n) => n.id === ballot.myVote);
  const headingId = `poll-${poll.id}`;
  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-h3">
          {poll.title}
        </h3>
        <p className="text-text-muted">{award.prompt}</p>
        <p className="text-small text-text-muted">
          {poll.seasonName} · Voting closes{" "}
          {closesAt(poll.closesAt, poll.timeZone)}
        </p>
      </div>
      {ballot.myVote ? (
        <p role={justVoted ? "status" : undefined} className="flex flex-col">
          <span className="font-bold text-success">
            Your vote: {pick?.name ?? "in"}
          </span>
          <span className="text-small text-text-muted">
            Results show when voting closes.
          </span>
        </p>
      ) : (
        <form
          action={castVoteAction.bind(null, poll.id)}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex grow flex-col gap-1">
            <label htmlFor={`pick-${poll.id}`}>Your pick</label>
            <select
              id={`pick-${poll.id}`}
              name="nominee"
              required
              defaultValue=""
              className={field}
            >
              <option value="" disabled>
                Choose {award.nominee === "team" ? "a team" : "a player"}
              </option>
              <Choices ballot={ballot} me={me} />
            </select>
          </div>
          <button type="submit" className="btn btn-primary">
            Cast vote
          </button>
        </form>
      )}
    </li>
  );
}

async function Vote({ searchParams }: PageProps<"/app/vote">) {
  await requireFeature("awards");
  const query = await searchParams;
  const subject = await requirePermission("registration.join", {
    next: "/app/vote",
  });
  const page = await votingPage(db, subject.userId, new Date());
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const voted = typeof query.voted === "string" ? query.voted : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app" className="underline">
          Home
        </Link>
        <h1 className="text-h1">Awards</h1>
        <p className="text-text-muted">
          Vote for the league&apos;s standouts. You get one vote per award, it
          can&apos;t be changed, and nobody sees who you picked. Totals stay
          hidden until voting closes.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      <section aria-labelledby="open" className="flex flex-col gap-3">
        <h2 id="open" className="text-h2">
          Open for voting
        </h2>
        {!page.onRoster ? (
          <p className="text-text-muted">
            Voting is for players on a team this season. Once you&apos;re on a
            roster, your ballots show up here.
          </p>
        ) : page.ballots.length === 0 ? (
          <p className="text-text-muted">
            No awards are open right now. Check back after the next game day.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {page.ballots.map((b) => (
              <BallotCard
                key={b.poll.id}
                ballot={b}
                me={subject.userId}
                justVoted={voted === b.poll.id}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="results" className="flex flex-col gap-3">
        <h2 id="results" className="text-h2">
          Results
        </h2>
        {page.closed.length === 0 ? (
          <p className="text-text-muted">
            No awards have closed yet. Winners show here when they do.
          </p>
        ) : (
          <ul className="flex flex-col">
            {page.closed.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 border-t border-border py-3"
              >
                <span className="flex flex-col">
                  <strong>{p.title}</strong>
                  <span className="text-small text-text-muted">
                    {p.seasonName}
                  </span>
                </span>
                <Link href={`/app/vote/${p.id}`} className="btn btn-secondary">
                  Results
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
