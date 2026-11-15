import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import {
  type AdminPoll,
  adminPoll,
  seasonPolls,
} from "@/db/queries/captain-polls";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  DETAIL_MAX,
  OPTION_MAX,
  OPTIONS_MAX,
  OPTIONS_MIN,
  TITLE_MAX,
} from "@/domain/captain-polls/captain-polls";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import {
  closePollAction,
  openPollAction,
  remindAction,
  removePollAction,
} from "./actions";

export const metadata: Metadata = { title: "Manage captains' polls" };

export default function CaptainPollsAdminPage(
  props: PageProps<"/app/admin/seasons/[season]/captain-polls">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <CaptainPolls {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  need_title: "Write the question.",
  title_too_long: `Keep the question under ${TITLE_MAX} characters.`,
  detail_too_long: `Keep the note under ${DETAIL_MAX} characters.`,
  too_few_options: `Give at least ${OPTIONS_MIN} options.`,
  too_many_options: `Give at most ${OPTIONS_MAX} options.`,
  option_too_long: `Keep each option under ${OPTION_MAX} characters.`,
  duplicate_option: "Two options are the same. Make each one different.",
  bad_voters: "Choose who may vote.",
  bad_results: "Choose when captains see the results.",
  bad_close: "Enter the date and time voting closes.",
  close_in_past: "Voting has to close in the future.",
  not_found: "That poll is gone.",
  not_open: "That poll isn't open, so there is nothing to close.",
};

const NOTICES: Record<string, string> = {
  opened: "Poll opened. Captains have been invited.",
  closed: "Voting closed. Captains can see the results.",
  removed: "Poll removed, with its votes.",
  reminded: "Reminders queued for the captains who haven't voted.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

const localDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);

const when = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);

function PollCard({ found, slug }: { found: AdminPoll; slug: string }) {
  const { poll, state } = found;
  const label = new Map(found.options.map((o) => [o.id, o.label]));
  return (
    <li className="flex flex-col gap-3 border-t border-border py-4">
      <div className="flex flex-col">
        <strong>{poll.title}</strong>
        <span className="text-small text-text-muted">
          {state === "closed" ? "Closed" : "Closes"}{" "}
          {when(poll.closesAt, poll.timeZone)} · {found.voted} of{" "}
          {found.teams.length} teams voted
          {poll.includeCoCaptains ? " · co-captains vote too" : ""}
          {poll.results === "at_close"
            ? " · captains see results at close"
            : " · captains see results after they vote"}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {found.options.map((o) => (
          <li key={o.id} className="flex justify-between gap-3">
            <span>
              {found.winners.includes(o.id) && state === "closed" ? "★ " : ""}
              {o.label}
            </span>
            <span className="text-text-muted">
              {o.votes} {o.votes === 1 ? "vote" : "votes"}
              {found.voted > 0 ? ` · ${o.percent}%` : ""}
            </span>
          </li>
        ))}
      </ul>
      <details className="text-small">
        <summary className="cursor-pointer underline">Who voted</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {found.teams.map((t) => (
            <li key={t.teamSeasonId}>
              <strong>{t.teamName}</strong>:{" "}
              {t.optionId
                ? `${label.get(t.optionId)}${t.voterName ? ` (${t.voterName})` : ""}`
                : "hasn't voted"}
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        {state !== "closed" && (
          <>
            <form action={closePollAction.bind(null, slug, poll.id)}>
              <SubmitButton className="btn btn-secondary">
                Close voting now
              </SubmitButton>
            </form>
            {found.voted < found.teams.length && (
              <form action={remindAction.bind(null, slug, poll.id)}>
                <SubmitButton className="btn btn-secondary">
                  Remind teams that haven&apos;t voted
                </SubmitButton>
              </form>
            )}
          </>
        )}
        <details className="text-small">
          <summary className="cursor-pointer underline">Remove…</summary>
          <form
            action={removePollAction.bind(null, slug, poll.id)}
            className="mt-2 flex flex-col items-start gap-2"
          >
            <p>This deletes the poll and every vote in it.</p>
            <SubmitButton className="btn btn-secondary">
              Remove poll
            </SubmitButton>
          </form>
        </details>
      </div>
    </li>
  );
}

async function CaptainPolls({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/captain-polls">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("captain_polls.manage", {
    next: `/app/admin/seasons/${slug}/captain-polls`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const now = new Date();
  const list = await seasonPolls(db, season.id, now);
  const found = (
    await Promise.all(list.map((p) => adminPoll(db, p.id, now)))
  ).flatMap((f) => f ?? []);
  const open = found.filter((f) => f.state !== "closed").reverse();
  const closed = found.filter((f) => f.state === "closed");
  const closesOn = localDate(
    new Date(now.getTime() + 3 * 86_400_000),
    season.timeZone,
  );
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Captains&apos; polls</h1>
        <p className="text-text-muted">
          Ask the season&apos;s captains a quick question. Each team gets one
          vote, and its captains can change it until voting closes. You see the
          totals as they come in.
        </p>
      </header>
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
      <section aria-labelledby="new" className="flex flex-col gap-3">
        <h2 id="new" className="text-h2">
          Ask a question
        </h2>
        <form
          action={openPollAction.bind(null, slug)}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1">
            Question
            <input
              name="title"
              required
              maxLength={TITLE_MAX}
              placeholder="Seven innings or five for playoffs?"
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            Note for captains (optional)
            <textarea
              name="detail"
              rows={3}
              maxLength={DETAIL_MAX}
              className={field}
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1">
              Options ({OPTIONS_MIN} to {OPTIONS_MAX}; leave spare boxes empty)
            </legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex flex-col gap-1">
                <span className="text-small text-text-muted">Option {n}</span>
                <input
                  name={`option${n}`}
                  required={n <= OPTIONS_MIN}
                  maxLength={OPTION_MAX}
                  className={field}
                />
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1">Who votes for a team</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="voters"
                value="captains"
                defaultChecked
              />
              The captain
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="voters" value="captains_and_co" />
              The captain or a co-captain (the last answer counts)
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1">When captains see the results</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="results"
                value="after_voting"
                defaultChecked
              />
              Once their team has voted
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="results" value="at_close" />
              When voting closes
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              Voting closes on
              <input
                type="date"
                name="closesOn"
                required
                defaultValue={closesOn}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              at
              <input
                type="time"
                name="closesTime"
                required
                defaultValue="21:00"
                className={field}
              />
            </label>
          </div>
          <SubmitButton className="btn self-start btn-primary">
            Open the poll
          </SubmitButton>
        </form>
      </section>
      <section aria-labelledby="live" className="flex flex-col gap-1">
        <h2 id="live" className="text-h2">
          Open now
        </h2>
        {open.length === 0 ? (
          <p className="text-text-muted">No polls are open.</p>
        ) : (
          <ul>
            {open.map((f) => (
              <PollCard key={f.poll.id} found={f} slug={slug} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="done" className="flex flex-col gap-1">
        <h2 id="done" className="text-h2">
          Closed
        </h2>
        {closed.length === 0 ? (
          <p className="text-text-muted">No polls have closed yet.</p>
        ) : (
          <ul>
            {closed.map((f) => (
              <PollCard key={f.poll.id} found={f} slug={slug} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
