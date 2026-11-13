import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SignupBoard } from "@/components/signup-board";
import { db } from "@/db/client";
import {
  challengeForSeason,
  challengeStandings,
} from "@/db/queries/challenges";
import { seasonForRegistration } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { formatMoment } from "@/domain/money/credit";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Sign-up challenge" };

type Props = PageProps<"/app/seasons/[season]/challenge">;

/**
 * The season's sign-up challenge for every signed-in player: teams by the
 * share of their roster signed up. Team names and counts only.
 */
export default function ChallengePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense
        fallback={<p className="min-h-svh">Loading the leaderboard…</p>}
      >
        <Challenge {...props} />
      </Suspense>
    </main>
  );
}

async function Challenge({ params }: Props) {
  const { season: slug } = await params;
  const subject = await requirePermission("challenge.view", {
    next: `/app/seasons/${slug}/challenge`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  const challenge = season ? await challengeForSeason(db, season.id) : null;
  if (!league || !season || !challenge) notFound();
  const board = await challengeStandings(db, challenge);
  const mine = board.find((t) =>
    subject.roster.some((m) => m.teamSeasonId === t.teamSeasonId),
  );
  const winner = challenge.winnerTeamSeasonId
    ? board.find((t) => t.teamSeasonId === challenge.winnerTeamSeasonId)
    : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Team sign-up challenge</h1>
        <p>
          <strong>Prize: {challenge.prize}.</strong> The first team whose whole
          roster has an account and has signed the waiver by{" "}
          {formatMoment(challenge.deadline, league.timeZone)} wins.
        </p>
      </header>
      {winner && (
        <p
          role="status"
          className="rounded-card border-2 border-success p-4 text-body-lg font-bold"
        >
          <span aria-hidden="true">🏆 </span>
          {winner.name} won the challenge!
        </p>
      )}
      {mine && (
        <p>
          Your team, {mine.name}: {mine.progress.signedUp} of {mine.progress.of}{" "}
          signed up.{" "}
          <Link
            href={`/app/seasons/${slug}/team`}
            className="inline-flex min-h-11 items-center underline"
          >
            Invite the rest
          </Link>
        </p>
      )}
      <SignupBoard
        rows={board}
        caption={`Leaderboard, ${season.name}`}
        highlight={mine?.teamSeasonId}
      />
    </>
  );
}
