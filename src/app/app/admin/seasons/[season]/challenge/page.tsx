import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SignupBoard } from "@/components/signup-board";
import { db } from "@/db/client";
import {
  challengeForSeason,
  challengeStandings,
  seasonSignups,
} from "@/db/queries/challenges";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  CHALLENGE_FORM_ERRORS,
  challengeFormValues,
  challengeLeader,
  MAX_CHALLENGE_PRIZE_LENGTH,
} from "@/domain/drive/challenge";
import { formatMoment } from "@/domain/money/credit";
import { requirePermission } from "@/lib/auth/permission";
import { confirmWinnerAction, saveChallengeAction } from "./actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Sign-up challenge" };

type Props = PageProps<"/app/admin/seasons/[season]/challenge">;

export default function ChallengeAdminPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <ChallengeAdmin {...props} />
      </Suspense>
    </main>
  );
}

const SAVED: Record<string, string> = {
  started: "Challenge started. Players see it on their team page.",
  updated: "Challenge saved.",
  confirmed: "Winner confirmed. It's in the audit log.",
};

const ERRORS: Record<string, string> = {
  ...CHALLENGE_FORM_ERRORS,
  confirmed: "The winner is confirmed, so the challenge can't change now.",
  not_complete: "That team hasn't signed up its whole roster by the deadline.",
  not_first: "Another team finished first.",
  not_found: "Start the challenge first.",
};

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

async function ChallengeAdmin({ params, searchParams }: Props) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/challenge`;
  await requirePermission("challenge.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const challenge = await challengeForSeason(db, season.id);
  const ranked = challenge ? await challengeStandings(db, challenge) : null;
  const board = ranked ?? (await seasonSignups(db, season.id));
  const leader = ranked ? challengeLeader(ranked) : null;
  // A dead heat at the top: the admin picks between the tied teams.
  const tied =
    ranked && !leader ? ranked.filter((t) => t.qualifies && t.rank === 1) : [];
  const winner = challenge?.winnerTeamSeasonId
    ? board.find((t) => t.teamSeasonId === challenge.winnerTeamSeasonId)
    : undefined;
  const at = (d: Date) => formatMoment(d, season.timeZone);
  const saved =
    typeof query.saved === "string" ? SAVED[query.saved] : undefined;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const values = challenge
    ? challengeFormValues(challenge, season.timeZone)
    : { prize: "", deadlineOn: "", deadlineTime: "23:59" };

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Sign-up challenge</h1>
        <p className="text-text-muted">
          The first team whose whole roster has an account and has signed the
          waiver wins. A team counts at its target roster size, or the
          season&apos;s minimum.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}

      {challenge && (
        <section aria-labelledby="prize" className="flex flex-col gap-2">
          <h2 id="prize" className="text-h2">
            {challenge.prize}
          </h2>
          <p>Deadline: {at(challenge.deadline)}</p>
          {challenge.confirmedAt ? (
            <p className="rounded-card border-2 border-success p-3 font-bold">
              Winner: {winner?.name ?? "a team no longer in the season"}
              {challenge.winnerCompletedAt &&
                `, complete ${at(challenge.winnerCompletedAt)}`}
            </p>
          ) : leader ? (
            <form
              action={confirmWinnerAction.bind(null, slug)}
              className="flex flex-col gap-2 rounded-card border-2 border-border p-3"
            >
              <input type="hidden" name="team" value={leader.teamSeasonId} />
              <p>
                <strong>{leader.name}</strong> finished first
                {leader.progress.completedAt &&
                  `, ${at(leader.progress.completedAt)}`}
                .
              </p>
              <button type="submit" className="btn self-start btn-primary">
                Confirm {leader.name} as the winner
              </button>
            </form>
          ) : tied.length > 1 ? (
            <form
              action={confirmWinnerAction.bind(null, slug)}
              className="flex flex-col gap-2 rounded-card border-2 border-border p-3"
            >
              <fieldset className="flex flex-col gap-1">
                <legend className="font-bold">
                  A dead heat: these teams finished at the same moment. Pick the
                  winner.
                </legend>
                {tied.map((t) => (
                  <label
                    key={t.teamSeasonId}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="radio"
                      name="team"
                      value={t.teamSeasonId}
                      required
                      className="size-5 accent-brand"
                    />
                    {t.name}
                  </label>
                ))}
              </fieldset>
              <button type="submit" className="btn self-start btn-primary">
                Confirm the winner
              </button>
            </form>
          ) : (
            <p className="text-text-muted">
              No team has signed up its whole roster yet.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="teams" className="flex flex-col gap-3">
        <h2 id="teams" className="text-h2">
          Sign-ups by team
        </h2>
        <SignupBoard
          rows={board}
          caption={`Sign-ups by team, ${season.name}`}
          nudge
        />
      </section>

      {!challenge?.confirmedAt && (
        <section aria-labelledby="edit" className="flex flex-col gap-3">
          <h2 id="edit" className="text-h2">
            {challenge ? "Change the challenge" : "Start a challenge"}
          </h2>
          <form
            action={saveChallengeAction.bind(null, slug)}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="prize-input" className="font-bold">
                Prize
              </label>
              <input
                id="prize-input"
                name="prize"
                required
                maxLength={MAX_CHALLENGE_PRIZE_LENGTH}
                defaultValue={values.prize}
                placeholder="A round of drinks for the team"
                className={control}
              />
            </div>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 font-bold">Deadline</legend>
              <div className="flex flex-col gap-1">
                <label htmlFor="deadline-on">Date</label>
                <input
                  id="deadline-on"
                  name="deadlineOn"
                  type="date"
                  required
                  defaultValue={values.deadlineOn}
                  className={control}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="deadline-time">Time</label>
                <input
                  id="deadline-time"
                  name="deadlineTime"
                  type="time"
                  required
                  defaultValue={values.deadlineTime}
                  className={control}
                />
              </div>
            </fieldset>
            <button type="submit" className="btn self-start btn-primary">
              {challenge ? "Save the challenge" : "Start the challenge"}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
