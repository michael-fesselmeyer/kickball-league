import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { teamAttendance } from "@/db/queries/attendance";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { activeLeague } from "@/lib/league/active";
import { playoffStanding } from "@/domain/attendance/attendance";
import { can } from "@/domain/authz/permissions";
import { requirePermission } from "@/lib/auth/permission";
import { PlayedList } from "./played-list";

export const metadata: Metadata = { title: "Team attendance" };

type Props = PageProps<"/[lang]/app/seasons/[season]/team/attendance">;

/**
 * A team's attendance (ADR 0063), for its captains: who played in each
 * game, and each player's games played against the season's playoff
 * minimum.
 */
export default function TeamAttendancePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading attendance…</p>}>
        <TeamAttendance {...props} />
      </Suspense>
    </main>
  );
}

async function TeamAttendance({ params }: Props) {
  const { season: slug } = await params;
  const page = `/app/seasons/${slug}/team/attendance`;
  const subject = await requirePermission("registration.join", { next: page });
  const league = await activeLeague();
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season || !league) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const team = mine?.team;
  if (
    !team ||
    !can(subject, "attendance.view", { teamSeasonId: team.teamSeasonId })
  )
    notFound();
  const a = await teamAttendance(db, {
    teamSeasonId: team.teamSeasonId,
    seasonId: season.id,
  });
  const when = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: league.timeZone,
        }).format(d)
      : "Not placed";
  const counts = new Map<string, number>();
  for (const p of [...a.players, ...a.subs])
    for (const id of p.gameIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/seasons/${slug}/team`} className="underline">
          {team.teamName}
        </Link>
        <h1 className="text-h1">Attendance</h1>
        <p className="text-text-muted">
          {a.playoffMinGames === null
            ? "This season sets no minimum games for the playoffs."
            : `Players need ${a.playoffMinGames} games played this season to play in the playoffs. Games for any team count.`}
        </p>
      </header>
      <PlayedList
        title="Players"
        rows={a.players.map((p) => ({
          userId: p.userId,
          name: p.name,
          played: p.played,
          standing: playoffStanding(p.played, a.playoffMinGames),
        }))}
      />
      {a.subs.length > 0 && (
        <section aria-labelledby="subs" className="flex flex-col gap-2">
          <h2 id="subs" className="text-h2">
            Subs and pickups who played for you
          </h2>
          <ul className="flex flex-col">
            {a.subs.map((s) => (
              <li
                key={s.userId}
                className="flex justify-between gap-2 border-t border-border py-2"
              >
                <span>{s.name}</span>
                <span className="text-text-muted tabular-nums">
                  {s.gameIds.length === 1
                    ? "1 game"
                    : `${s.gameIds.length} games`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="games" className="flex flex-col gap-2">
        <h2 id="games" className="text-h2">
          Games
        </h2>
        {a.games.length === 0 ? (
          <p className="text-text-muted">No games on the schedule yet.</p>
        ) : (
          <ul className="flex flex-col">
            {a.games.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
              >
                <Link
                  href={`/app/games/${g.id}/attendance`}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {when(g.startsAt)} vs {g.opponent}
                </Link>
                <span className="text-text-muted tabular-nums">
                  {counts.get(g.id) ?? 0} checked in
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
