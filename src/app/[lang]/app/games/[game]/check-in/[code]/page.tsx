import type { Metadata } from "next";
import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { attendanceGame, checkedInFor } from "@/db/queries/attendance";
import { isCurrentFieldCode, scanOpen } from "@/domain/attendance/attendance";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { checkInForGameAction } from "../actions";

export const metadata: Metadata = {
  title: "Check in for the game",
  robots: { index: false },
};

type Props = PageProps<"/app/games/[game]/check-in/[code]">;

/**
 * Where the code at the field lands (ADR 0063): one tap records that the
 * player played. Opening the page alone records nothing.
 */
export default function GameCheckInPage(props: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<p className="min-h-svh">Loading the game…</p>}>
        <CheckIn {...props} />
      </Suspense>
    </main>
  );
}

const PROBLEMS: Record<string, string> = {
  expired:
    "The code changes every few minutes, so this one has expired. Scan the code on the captain's or ref's phone again.",
  closed: "Check-in for this game is closed. Ask your captain to tick you in.",
  not_playing:
    "You're not on either team's roster or approved to sub in this game. Ask a captain to add you, or to approve your sub claim, then scan again.",
};

async function CheckIn({ params, searchParams }: Props) {
  const { game: rawId, code } = await params;
  const query = await searchParams;
  const page = `/app/games/${rawId}/check-in/${code}`;
  const subject = await requirePermission("attendance.check_in", {
    next: page,
  });
  const gameId = parseId<GameId>(rawId);
  const userId = parseId<UserId>(subject.userId);
  const g = gameId ? await attendanceGame(db, gameId) : null;
  if (!g || !userId) notFound();
  const title = `${g.teamAName} vs ${g.teamBName}`;
  const mine = await checkedInFor(db, g.id, userId);
  if (mine)
    return (
      <>
        <div className="flex flex-col gap-2">
          <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
            {title}
          </p>
          <h1 className="text-h1">You&apos;re checked in</h1>
          <p role="status">
            You&apos;re on the record as playing for{" "}
            {mine.teamSeasonId === g.teamAId ? g.teamAName : g.teamBName}. Have
            a great game.
          </p>
        </div>
        <Link href="/app" className="btn btn-secondary">
          Back to your home screen
        </Link>
      </>
    );

  const now = new Date();
  const error = typeof query.error === "string" ? query.error : null;
  const problem =
    error && PROBLEMS[error]
      ? PROBLEMS[error]
      : !scanOpen(g, now).ok
        ? PROBLEMS.closed
        : !isCurrentFieldCode(env.BETTER_AUTH_SECRET, g.id, code, now)
          ? PROBLEMS.expired
          : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
          {title}
        </p>
        <h1 className="text-h1">Check in for the game</h1>
        <p className="text-text-muted">
          Checking in records that you played today. It counts toward your games
          played for the playoffs.
        </p>
      </div>
      {problem ? (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {problem}
        </p>
      ) : (
        <form action={checkInForGameAction.bind(null, g.id, code)}>
          <SubmitButton className="btn w-full btn-primary">
            Check in
          </SubmitButton>
        </form>
      )}
    </>
  );
}
