import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { seasonStarts } from "@/db/queries/game-start";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  type HeldUpBy,
  isLateStart,
  LATE_GRACE_MINUTES,
  minutesLate,
} from "@/domain/gameday/daylight";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague, activeLeagueId } from "@/lib/league/active";

export const metadata: Metadata = { title: "Start times" };

type Props = PageProps<"/[lang]/app/admin/seasons/[season]/starts">;

/**
 * Whether games start on time (issue #467): per team, its recorded starts,
 * the late ones it held up and the minutes they cost, then every late start.
 * Refs record first pitch with one tap on the live score screen.
 */
export default function StartTimesPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading start times…</PageLoading>}>
        <Starts {...props} />
      </Suspense>
    </main>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function heldUpLine(
  heldUpBy: HeldUpBy | null,
  teamA: string,
  teamB: string,
): string {
  switch (heldUpBy) {
    case "team_a":
      return `held up by ${teamA}`;
    case "team_b":
      return `held up by ${teamB}`;
    case "both":
      return "held up by both teams";
    case "neither":
      return "not the teams' doing";
    case null:
      return "nobody said who held it up";
  }
}

async function Starts({ params }: Props) {
  const { season: slug } = await params;
  await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}/starts`,
  });
  const [season, league] = await Promise.all([
    activeLeagueId().then((id) => seasonBySlug(db, id, slug)),
    activeLeague(),
  ]);
  if (!season) notFound();
  const tz = league?.timeZone ?? "America/New_York";
  const { teams, starts } = await seasonStarts(db, season.id);
  const late = starts.filter((s) => isLateStart(s.firstPitchAt, s.startedAt));

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Start times</h1>
        <p className="text-text-muted">
          Refs tap “First pitch” on the live score screen. A start more than{" "}
          {LATE_GRACE_MINUTES} minutes after the game’s time is late, and the
          ref says who held it up. Late starts cost daylight and field time.
        </p>
      </header>

      {starts.length === 0 ? (
        <p className="text-text-muted">No starts recorded this season yet.</p>
      ) : (
        <>
          <section aria-labelledby="by-team" className="flex flex-col gap-3">
            <h2 id="by-team" className="text-h2">
              By team
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3">
                      Team
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      Starts
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right">
                      Late, their doing
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Minutes lost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.teamSeasonId} className="border-b border-border">
                      <th scope="row" className="py-2 pr-3 font-normal">
                        {t.teamName}
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {t.starts}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {t.lateStarts}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {t.minutesLost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="late" className="flex flex-col gap-3">
            <h2 id="late" className="text-h2">
              {late.length === 0
                ? "No late starts"
                : plural(late.length, "late start")}
            </h2>
            {late.length > 0 && (
              <ul className="flex flex-col gap-2">
                {late.map((s) => (
                  <li key={s.gameId}>
                    <Link
                      href={`/app/games/${s.gameId}/score`}
                      className="underline"
                    >
                      {s.teamA} vs {s.teamB}
                    </Link>
                    <span className="text-text-muted">
                      {" "}
                      · {shortDay(s.firstPitchAt, tz)}, {s.fieldName}: due{" "}
                      {kickoff(s.firstPitchAt, tz)}, first pitch{" "}
                      {kickoff(s.startedAt, tz)} (
                      {plural(
                        minutesLate(s.firstPitchAt, s.startedAt),
                        "minute",
                      )}{" "}
                      late, {heldUpLine(s.heldUpBy, s.teamA, s.teamB)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
