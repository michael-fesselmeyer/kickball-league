import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  winBackCandidates,
  winBackResults,
  winBackSeason,
  winBackTemplateOf,
} from "@/db/queries/win-back";
import { formatMoment } from "@/domain/money/credit";
import {
  type Candidate,
  LOOKBACK_SEASONS,
  stateOf,
} from "@/domain/win-back/win-back";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { saveTemplateAction, sendAllAction, sendOneAction } from "./actions";

export const metadata: Metadata = { title: "Win back past players" };

type Props = PageProps<"/[lang]/app/admin/seasons/[season]/win-back">;

export default function WinBackPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <WinBack {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  not_open: "The win-back email goes out only while registration is open.",
  subject: "Write a subject of up to 120 characters.",
  body: "Write a message of up to 2,000 characters.",
};

const input =
  "min-h-11 rounded-md border border-border-strong bg-surface px-2 py-1";

async function WinBack({ params, searchParams }: Props) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/win-back`;
  await requirePermission("win_back.manage", { next: page });
  await connection();
  const league = await activeLeague();
  const season = await winBackSeason(db, league?.id, slug);
  if (!season || !league) notFound();
  const open = season.status === "registration_open";
  const [template, candidates, results] = await Promise.all([
    winBackTemplateOf(db, season.leagueId),
    open ? winBackCandidates(db, season) : Promise.resolve([]),
    winBackResults(db, season.id),
  ]);
  const ready = candidates.filter((c) => stateOf(c) === "ready").length;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const sent = Number(query.sent);
  const notice = Number.isInteger(sent)
    ? sent === 0
      ? "Nobody new to email: they've all had it, opted out or signed up."
      : `Email queued for ${sent} ${sent === 1 ? "player" : "players"}. It goes out with the next batch, outside quiet hours.`
    : query.saved === "1"
      ? "Wording saved."
      : undefined;
  const at = (d: Date) => formatMoment(d, league.timeZone);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Win back past players</h1>
        <p className="text-text-muted">
          Players from the last {LOOKBACK_SEASONS} seasons who haven&apos;t
          signed up for {season.name} yet, the most loyal first. Each can get
          one friendly email this season. Anyone who turned off league news
          isn&apos;t emailed.
        </p>
        {error && (
          <p role="alert" className="rounded-lg border border-danger p-3">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-success p-3">
            {notice}
          </p>
        )}
        <p>
          Emailed this season: <strong>{results.emailed}</strong> · Came back:{" "}
          <strong>{results.cameBack}</strong>
        </p>
      </header>

      {!open ? (
        <p className="rounded-lg border border-border bg-surface p-3">
          The list shows while {season.name}&apos;s registration is open.
        </p>
      ) : candidates.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-3">
          Everyone from the last {LOOKBACK_SEASONS} seasons has signed up
          already.
        </p>
      ) : (
        <section aria-labelledby="list" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="list" className="text-h2">
              Not signed up yet ({candidates.length})
            </h2>
            {ready > 0 && (
              <form action={sendAllAction.bind(null, slug)}>
                <SubmitButton className="btn btn-primary">
                  Email all {ready} not emailed yet
                </SubmitButton>
              </form>
            )}
          </div>
          <ul className="flex flex-col">
            {candidates.map((c) => (
              <Row key={c.userId} c={c} slug={slug} at={at} />
            ))}
          </ul>
        </section>
      )}

      <section
        id="wording"
        aria-labelledby="wording-title"
        className="flex flex-col gap-3"
      >
        <h2 id="wording-title" className="text-h2">
          The email
        </h2>
        <p className="text-small text-text-muted">
          Use {"{first_name}"}, {"{season}"} and {"{team}"} to fill in each
          player&apos;s first name, this season and their last team. A blank
          line starts a new paragraph. Past captains get a button to register
          their team, free agents one to the free-agent page, and everyone else
          one to sign up.
          {!template.custom && " This is the league's default wording."}
        </p>
        <form
          action={saveTemplateAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1">
            Subject
            <input
              name="subject"
              defaultValue={template.subject}
              maxLength={120}
              required
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Message
            <textarea
              name="body"
              defaultValue={template.body}
              maxLength={2000}
              rows={8}
              required
              className={`${input} py-2`}
            />
          </label>
          <SubmitButton className="btn self-start btn-secondary">
            Save the wording
          </SubmitButton>
        </form>
      </section>
    </>
  );
}

function Row({
  c,
  slug,
  at,
}: {
  c: Candidate;
  slug: string;
  at: (d: Date) => string;
}) {
  const state = stateOf(c);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-3">
      <span className="flex min-w-0 flex-col">
        <span className="font-bold">{c.name}</span>
        <span className="text-small text-text-muted">
          {c.lastTeam ??
            (c.lastRole === "free_agent" ? "Free agent" : "No team")}{" "}
          in {c.lastSeasonName} · {c.seasonsPlayed}{" "}
          {c.seasonsPlayed === 1 ? "season" : "seasons"}
          {c.lastRole === "captain" && " · captain"}
        </span>
      </span>
      {state === "ready" ? (
        <form action={sendOneAction.bind(null, slug)}>
          <input type="hidden" name="userId" value={c.userId} />
          <SubmitButton className="btn btn-secondary">
            Email
            <span className="sr-only"> {c.name}</span>
          </SubmitButton>
        </form>
      ) : state === "emailed" && c.emailedAt ? (
        <span className="text-small text-success">
          Emailed {at(c.emailedAt)}
        </span>
      ) : (
        <span className="text-small text-text-muted">
          Opted out of league news
        </span>
      )}
    </li>
  );
}
