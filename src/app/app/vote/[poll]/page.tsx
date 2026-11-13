import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { pollResults } from "@/db/queries/awards";
import { CATEGORIES, winnerLine } from "@/domain/awards/awards";
import { type AwardPollId, parseId } from "@/domain/ids";
import { ordinal } from "@/domain/share/cards";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";

export const metadata: Metadata = { title: "Award results" };

export default function ResultsPage(props: PageProps<"/app/vote/[poll]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Counting the votes…</p>}>
        <Results {...props} />
      </Suspense>
    </main>
  );
}

async function Results({ params }: PageProps<"/app/vote/[poll]">) {
  await requireFeature("awards");
  const { poll: raw } = await params;
  await requirePermission("registration.join", { next: `/app/vote/${raw}` });
  const pollId = parseId<AwardPollId>(raw);
  const found = pollId ? await pollResults(db, pollId, new Date()) : null;
  if (!found) notFound();
  const { poll, results } = found;
  const award = CATEGORIES[poll.category];
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: poll.timeZone,
  }).format(poll.closesAt);
  const top = results?.rows[0]?.votes ?? 0;
  const headline = results
    ? winnerLine(results.winners.map((w) => w.name))
    : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/vote" className="underline">
          Awards
        </Link>
        <h1 className="text-h1">{poll.title}</h1>
        <p className="text-text-muted">
          {award.label} · {poll.seasonName} ·{" "}
          {results ? `Voting closed ${when}` : `Voting closes ${when}`}
        </p>
      </header>
      {!results ? (
        <p className="rounded-lg border border-border p-4">
          Voting is still open, so the totals are hidden. Results show here once
          it closes.
        </p>
      ) : results.total === 0 ? (
        <p className="rounded-lg border border-border p-4">
          No votes were cast for this award.
        </p>
      ) : (
        <>
          <section
            aria-labelledby="winner"
            className="flex flex-col gap-1 rounded-lg border-2 border-brand bg-surface p-4"
          >
            <h2 id="winner" className="text-h2">
              {headline}
            </h2>
            <p className="text-text-muted">
              {results.winners.length > 1
                ? "A tie at the top: everyone tied shares the award."
                : award.nominee === "player" && results.winners[0]?.teamName
                  ? `Plays for ${results.winners[0].teamName}.`
                  : "Congratulations!"}
            </p>
          </section>
          <section aria-labelledby="tally" className="flex flex-col gap-3">
            <h2 id="tally" className="text-h2">
              The votes
            </h2>
            <ol className="flex flex-col gap-3">
              {results.rows.map((r) => (
                <li key={r.nomineeId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>
                      <span className="text-text-muted">
                        {ordinal(r.rank)}{" "}
                      </span>
                      <strong>{r.name}</strong>
                      {r.teamName && (
                        <span className="text-small text-text-muted">
                          {" "}
                          · {r.teamName}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      {r.votes} {r.votes === 1 ? "vote" : "votes"}
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="h-2 rounded-full bg-surface-2"
                  >
                    <div
                      className="h-2 rounded-full bg-brand"
                      style={{ width: `${(r.votes / top) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-small text-text-muted">
              {results.total} {results.total === 1 ? "vote" : "votes"} cast.
            </p>
          </section>
        </>
      )}
    </>
  );
}
