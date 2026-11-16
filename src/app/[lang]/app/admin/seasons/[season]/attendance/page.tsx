import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PlayedList } from "@/app/[lang]/app/seasons/[season]/team/attendance/played-list";
import { db } from "@/db/client";
import { seasonAttendance } from "@/db/queries/attendance";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { playoffStanding } from "@/domain/attendance/attendance";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";

export const metadata: Metadata = { title: "Season attendance" };

type Props = PageProps<"/[lang]/app/admin/seasons/[season]/attendance">;

/**
 * Every team's games played this season (ADR 0063), for admins checking
 * playoff eligibility against the season's minimum.
 */
export default function SeasonAttendancePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading attendance…</p>}>
        <Attendance {...props} />
      </Suspense>
    </main>
  );
}

async function Attendance({ params }: Props) {
  const { season: slug } = await params;
  await requirePermission("attendance.view", {
    next: `/app/admin/seasons/${slug}/attendance`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const a = await seasonAttendance(db, season.id);
  const short = a.teams.flatMap((t) =>
    t.players.filter(
      (p) => playoffStanding(p.played, a.playoffMinGames)?.eligible === false,
    ),
  ).length;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Attendance</h1>
        <p className="text-text-muted">
          {a.playoffMinGames === null
            ? "Games played come from field check-in. This season sets no playoff minimum; set one in the season's settings."
            : `Players need ${a.playoffMinGames} games played to play in the playoffs. ${short === 1 ? "1 player is" : `${short} players are`} short so far.`}
        </p>
      </header>
      {a.teams.length === 0 ? (
        <p className="text-text-muted">No teams in this season yet.</p>
      ) : (
        a.teams.map((t) => (
          <PlayedList
            key={t.teamSeasonId}
            title={t.teamName}
            rows={t.players.map((p) => ({
              ...p,
              standing: playoffStanding(p.played, a.playoffMinGames),
            }))}
          />
        ))
      )}
    </>
  );
}
