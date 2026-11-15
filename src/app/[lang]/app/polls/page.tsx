import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { type CaptainBallot, captainBallots } from "@/db/queries/captain-polls";
import { requirePermission } from "@/lib/auth/permission";
import { castPollVoteAction } from "./actions";

export const metadata: Metadata = { title: "Captains' polls" };

export default function PollsPage(props: PageProps<"/app/polls">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the polls…</PageLoading>}>
        <Polls {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  not_open: "Voting has closed for that poll.",
  not_a_voter: "Only a team's captain can vote for it in this poll.",
  not_an_option: "Pick one of the options.",
  team_not_in_poll: "That team isn't in this poll.",
  not_found: "That poll is gone.",
};

const closesAt = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);

function Results({ ballot }: { ballot: CaptainBallot }) {
  const results = ballot.results;
  if (!results) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Results so far">
      {results.rows.map((r) => (
        <li key={r.id} className="flex justify-between gap-3">
          <span>
            {results.winners.includes(r.id) && ballot.state === "closed"
              ? "★ "
              : ""}
            {r.label}
          </span>
          <span className="text-text-muted">
            {r.votes} {r.votes === 1 ? "vote" : "votes"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PollCard({
  ballot,
  justVoted,
}: {
  ballot: CaptainBallot;
  justVoted: boolean;
}) {
  const { poll } = ballot;
  const open = ballot.state === "open";
  const label = new Map(ballot.options.map((o) => [o.id, o.label]));
  return (
    <li
      aria-labelledby={`poll-${poll.id}`}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id={`poll-${poll.id}`} className="text-h3">
          {poll.title}
        </h3>
        {poll.detail && (
          <p className="whitespace-pre-line text-text-muted">{poll.detail}</p>
        )}
        <p className="text-small text-text-muted">
          {poll.seasonName} · {open ? "Voting closes" : "Closed"}{" "}
          {closesAt(poll.closesAt, poll.timeZone)}
        </p>
      </div>
      {ballot.teams.map((t) => (
        <div key={t.teamSeasonId} className="flex flex-col gap-2">
          {t.myOptionId && (
            <p role={justVoted ? "status" : undefined}>
              <strong className="text-success">
                {t.teamName} voted: {label.get(t.myOptionId)}
              </strong>
              {t.changedByOther && (
                <span className="block text-small text-text-muted">
                  Another captain of {t.teamName} cast this vote.
                </span>
              )}
            </p>
          )}
          {open && (
            <form
              action={castPollVoteAction.bind(null, poll.id)}
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="team" value={t.teamSeasonId} />
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1">
                  {t.myOptionId
                    ? `Change ${t.teamName}'s vote`
                    : `${t.teamName}'s vote`}
                </legend>
                {ballot.options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="option"
                      value={o.id}
                      required
                      defaultChecked={o.id === t.myOptionId}
                    />
                    {o.label}
                  </label>
                ))}
              </fieldset>
              <SubmitButton className="btn self-start btn-primary">
                {t.myOptionId ? "Change vote" : "Cast vote"}
              </SubmitButton>
            </form>
          )}
        </div>
      ))}
      {ballot.results ? (
        <Results ballot={ballot} />
      ) : (
        <p className="text-small text-text-muted">
          {poll.results === "at_close"
            ? "Results show when voting closes."
            : "Results show once your team has voted."}
        </p>
      )}
    </li>
  );
}

async function Polls({ searchParams }: PageProps<"/app/polls">) {
  const query = await searchParams;
  const subject = await requirePermission("captain_polls.vote", {
    next: "/app/polls",
  });
  const ballots = await captainBallots(db, subject.userId, new Date());
  const open = ballots.filter((b) => b.state === "open");
  const closed = ballots.filter((b) => b.state === "closed").reverse();
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const voted = typeof query.voted === "string" ? query.voted : null;
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app" className="underline">
          Home
        </Link>
        <h1 className="text-h1">Captains&apos; polls</h1>
        <p className="text-text-muted">
          Quick questions from the league. Your team has one vote, and you can
          change it until voting closes.
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
        {open.length === 0 ? (
          <p className="text-text-muted">No polls are open right now.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map((b) => (
              <PollCard
                key={b.poll.id}
                ballot={b}
                justVoted={voted === b.poll.id}
              />
            ))}
          </ul>
        )}
      </section>
      {closed.length > 0 && (
        <section aria-labelledby="closed" className="flex flex-col gap-3">
          <h2 id="closed" className="text-h2">
            Recently closed
          </h2>
          <ul className="flex flex-col gap-3">
            {closed.map((b) => (
              <PollCard key={b.poll.id} ballot={b} justVoted={false} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
