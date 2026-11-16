import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import {
  dayName,
  leadershipQuorum,
  type SeasonLeadershipRow,
  seasonLeadership,
} from "@/db/queries/leadership";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  CHECK_IN_DAYS,
  canOpenFor,
  type Outcome,
  type Step,
} from "@/domain/leadership/leadership";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import {
  closeAction,
  openCheckInsAction,
  pauseAction,
  resumeAction,
  setQuorumAction,
} from "./actions";

export const metadata: Metadata = { title: "Leadership check-ins" };

/** Messages by code; an unknown code from the URL finds nothing. */
const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  opened: { ok: true, text: "Check-ins opened. Every roster has been told." },
  quorum_saved: { ok: true, text: "Quorum saved for new check-ins." },
  paused_now: { ok: true, text: "Paused. Nobody can check in or vote until you resume." },
  resumed: { ok: true, text: "Resumed, with the deadline moved on." },
  closed_now: { ok: true, text: "Closed with no change. The team has been told." },
  not_season_end: {
    ok: false,
    text: "Check-ins open only once the regular season is over (playoffs or completed).",
  },
  bad_close: {
    ok: false,
    text: `Choose between ${CHECK_IN_DAYS.min} and ${CHECK_IN_DAYS.max} days.`,
  },
  bad_quorum: { ok: false, text: "Choose a quorum between 50% and 100%." },
  closed: { ok: false, text: "That check-in has already closed." },
  paused: { ok: false, text: "That check-in is already paused." },
  not_paused: { ok: false, text: "That check-in isn't paused." },
  not_found: { ok: false, text: "That check-in is gone." },
};

const STEP: Record<Step, string> = {
  check_in: "Checking in",
  ballot: "Secret ballot",
  captain_review: "With the captain",
  closed: "Done",
};

const OUTCOME: Record<Outcome, string> = {
  no_quorum: "Not enough took part",
  no_candidates: "Nobody stood; no change",
  no_majority: "No clear majority; no change",
  captain_stays: "Captain stays",
  new_captain: "New captain",
  winner_left: "Chosen teammate left; no change",
  closed_by_league: "Closed by the league",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

export default function LeadershipAdminPage(
  props: PageProps<"/app/admin/seasons/[season]/leadership">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <LeadershipAdmin {...props} />
      </Suspense>
    </main>
  );
}

async function LeadershipAdmin({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/leadership">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("leadership.manage", {
    next: `/app/admin/seasons/${slug}/leadership`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const [rows, quorum] = await Promise.all([
    seasonLeadership(db, season.id),
    leadershipQuorum(db, season.leagueId),
  ]);
  const code = typeof query.leadership === "string" ? query.leadership : "";
  const message = MESSAGES[code];
  const canOpen = canOpenFor(season.status);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Leadership check-ins</h1>
        <p className="text-text-muted">
          At season end, every team gets a private check-in about who&apos;d
          like to help lead next season, and a secret ballot only if enough of
          the roster takes part and a teammate stands for captain. Nobody, the
          league included, sees who suggested or voted for whom; you see the
          step, how many took part and, once the team has heard, the outcome.
        </p>
      </header>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg border p-3 ${message.ok ? "border-success" : "border-danger"}`}
        >
          {message.text}
        </p>
      )}

      <section aria-labelledby="open" className="flex flex-col gap-3">
        <h2 id="open" className="text-h2">
          Open check-ins
        </h2>
        {canOpen ? (
          <form
            action={openCheckInsAction.bind(null, slug)}
            className="flex flex-col gap-2"
          >
            <label htmlFor="days">Days to check in</label>
            <input
              id="days"
              name="days"
              type="number"
              inputMode="numeric"
              min={CHECK_IN_DAYS.min}
              max={CHECK_IN_DAYS.max}
              defaultValue={CHECK_IN_DAYS.default}
              required
              className={`${field} w-24`}
            />
            <p className="text-small text-text-muted">
              Opens one for every team with a roster that hasn&apos;t had one
              this season, and tells everyone on it.
            </p>
            <SubmitButton className="btn self-start btn-primary">
              Open check-ins
            </SubmitButton>
          </form>
        ) : (
          <p>
            Check-ins open once the regular season is over, never mid-season.
          </p>
        )}
      </section>

      <section aria-labelledby="quorum" className="flex flex-col gap-3">
        <h2 id="quorum" className="text-h2">
          Quorum
        </h2>
        <form
          action={setQuorumAction.bind(null, slug)}
          className="flex flex-col gap-2"
        >
          <label htmlFor="percent">
            Share of the roster that must take part, in percent
          </label>
          <input
            id="percent"
            name="percent"
            type="number"
            inputMode="numeric"
            min={50}
            max={100}
            defaultValue={quorum}
            required
            className={`${field} w-24`}
          />
          <p className="text-small text-text-muted">
            For the whole league. Check-ins already open keep the quorum they
            opened with.
          </p>
          <SubmitButton className="btn self-start btn-secondary">
            Save quorum
          </SubmitButton>
        </form>
      </section>

      <section aria-labelledby="teams" className="flex flex-col gap-3">
        <h2 id="teams" className="text-h2">
          Teams
        </h2>
        {rows.length === 0 ? (
          <p>No check-ins this season yet.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <TeamRow
                key={row.checkInId}
                row={row}
                slug={slug}
                timeZone={season.timeZone}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function TeamRow({
  row,
  slug,
  timeZone,
}: {
  row: SeasonLeadershipRow;
  slug: string;
  timeZone: string;
}) {
  const open = row.step !== "closed";
  return (
    <li className="flex flex-col gap-2 border-t border-border py-3">
      <div className="flex flex-col">
        <strong>{row.team}</strong>
        <span className="text-small text-text-muted">
          {row.paused ? "Paused" : STEP[row.step]}
          {row.outcome && ` · ${OUTCOME[row.outcome]}`}
          {open &&
            row.step !== "captain_review" &&
            ` · ${row.tookPart} of ${row.roster} took part, ${row.needed} needed`}
          {open && row.closesAt && ` · until ${dayName(row.closesAt, timeZone)}`}
        </span>
      </div>
      {open && (
        <div className="flex flex-wrap gap-3">
          <form
            action={(row.paused ? resumeAction : pauseAction).bind(
              null,
              slug,
              row.checkInId,
            )}
          >
            <SubmitButton className="inline-flex min-h-11 items-center underline">
              {row.paused ? "Resume" : "Pause"}
              <span className="sr-only"> {row.team}&apos;s check-in</span>
            </SubmitButton>
          </form>
          <form action={closeAction.bind(null, slug, row.checkInId)}>
            <SubmitButton className="inline-flex min-h-11 items-center underline">
              Close with no change
              <span className="sr-only"> for {row.team}</span>
            </SubmitButton>
          </form>
        </div>
      )}
    </li>
  );
}
