import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { gameDaysOf, type Poll, seasonPolls } from "@/db/queries/awards";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  CATEGORIES,
  CATEGORY_KEYS,
  gameDayLabel,
  pollState,
  TITLE_MAX,
} from "@/domain/awards/awards";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { closePollAction, openPollAction, removePollAction } from "./actions";

export const metadata: Metadata = { title: "Awards" };

export default function AwardsAdminPage(
  props: PageProps<"/app/admin/seasons/[season]/awards">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Awards {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  bad_kind: "Choose weekly or season.",
  bad_category: "Choose an award.",
  pick_game_day: "Choose the game day a weekly award is for.",
  unknown_game_day: "That isn't one of this season's game days.",
  bad_close: "Enter the date and time voting closes.",
  close_in_past: "Voting has to close in the future.",
  title_too_long: `Keep the title under ${TITLE_MAX} characters.`,
  not_found: "That poll is gone.",
  not_open: "That poll isn't open, so there is nothing to close.",
};

const NOTICES: Record<string, string> = {
  opened: "Poll opened. Players on a roster can vote now.",
  closed: "Voting closed. The results are up.",
  removed: "Poll removed, with its votes.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

/** A date in the league's zone as YYYY-MM-DD. */
const localDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);

function PollRow({ poll, slug, now }: { poll: Poll; slug: string; now: Date }) {
  const state = pollState(poll, now);
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: poll.timeZone,
  }).format(poll.closesAt);
  return (
    <li className="flex flex-col gap-2 border-t border-border py-3">
      <div className="flex flex-col">
        <strong>{poll.title}</strong>
        <span className="text-small text-text-muted">
          {CATEGORIES[poll.category].label} ·{" "}
          {poll.kind === "weekly" && poll.gameDay
            ? `Game day ${gameDayLabel(poll.gameDay)}`
            : "Whole season"}{" "}
          · {state === "closed" ? `Closed ${when}` : `Closes ${when}`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {state === "closed" ? (
          <Link href={`/app/vote/${poll.id}`} className="btn btn-secondary">
            Results
          </Link>
        ) : (
          <form action={closePollAction.bind(null, slug, poll.id)}>
            <button type="submit" className="btn btn-secondary">
              Close voting now
            </button>
          </form>
        )}
        <details className="text-small">
          <summary className="cursor-pointer underline">Remove…</summary>
          <form
            action={removePollAction.bind(null, slug, poll.id)}
            className="mt-2 flex flex-col items-start gap-2"
          >
            <p>This deletes the poll and every vote in it.</p>
            <button type="submit" className="btn btn-secondary">
              Remove poll
            </button>
          </form>
        </details>
      </div>
    </li>
  );
}

async function Awards({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/awards">) {
  await requireFeature("awards");
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("awards.manage", {
    next: `/app/admin/seasons/${slug}/awards`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const [days, polls] = await Promise.all([
    gameDaysOf(db, season.id),
    seasonPolls(db, season.id),
  ]);
  const now = new Date();
  const today = localDate(now, season.timeZone);
  const lastPlayed = days.filter((d) => d <= today).at(-1) ?? days[0] ?? "";
  const closesOn = localDate(
    new Date(now.getTime() + 3 * 86_400_000),
    season.timeZone,
  );
  const open = polls.filter((p) => pollState(p, now) !== "closed");
  const closed = polls.filter((p) => pollState(p, now) === "closed");
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
        <h1 className="text-h1">Awards</h1>
        <p className="text-text-muted">
          Open a poll for a game day or the whole season. Players on a roster
          vote once; nobody sees the totals, admins included, until voting
          closes.
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
          Open a poll
        </h2>
        <form
          action={openPollAction.bind(null, slug)}
          className="flex flex-col gap-4"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1">For</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="kind"
                value="weekly"
                defaultChecked={days.length > 0}
                disabled={days.length === 0}
              />
              One game day
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="kind"
                value="season"
                defaultChecked={days.length === 0}
              />
              The whole season
            </label>
          </fieldset>
          {days.length === 0 ? (
            <p className="text-small text-text-muted">
              No games are on the schedule yet, so only season awards can open.
            </p>
          ) : (
            <label className="flex flex-col gap-1">
              Game day (for a game-day award)
              <select
                name="gameDay"
                defaultValue={lastPlayed}
                className={field}
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    {gameDayLabel(d)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            Award
            <select name="category" defaultValue="mvp" className={field}>
              {CATEGORY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIES[c].label}
                  {CATEGORIES[c].nominee === "team" ? " (teams)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Title (optional)
            <input
              name="title"
              maxLength={TITLE_MAX}
              placeholder="Named for you, such as “MVP, Mon, Oct 5”"
              className={field}
            />
          </label>
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
          <button type="submit" className="btn self-start btn-primary">
            Open voting
          </button>
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
            {open.map((p) => (
              <PollRow key={p.id} poll={p} slug={slug} now={now} />
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
            {closed.map((p) => (
              <PollRow key={p.id} poll={p} slug={slug} now={now} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
