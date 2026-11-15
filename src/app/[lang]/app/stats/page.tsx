import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import {
  awardsWonBy,
  gatherSeasons,
  isOptedOut,
  pollWinsBy,
  seasonsPlayedBy,
} from "@/db/queries/stat-awards";
import {
  careerStats,
  type CareerStats,
  coverageNote,
  seasonStats,
  type SeasonStats,
  STAT_AWARDS,
} from "@/domain/awards/stat-awards";
import { requireSelf } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import { setOptOutAction } from "./actions";

export const metadata: Metadata = { title: "Your stats" };

export default function StatsPage(props: PageProps<"/app/stats">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading your stats…</PageLoading>}>
        <Stats {...props} />
      </Suspense>
    </main>
  );
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

type Row = { label: string; value: string; note?: string };

/** The rows for a season or a career; a stat without enough games says so. */
function rowsOf(s: SeasonStats | CareerStats, awards: number): Row[] {
  const attendanceNote = coverageNote(s.recorded, s.teamGames);
  return [
    {
      label: "Games played",
      value: String(s.gamesPlayed),
      note: attendanceNote,
    },
    {
      label: "Attendance",
      value:
        s.attendanceRate === null ? "Too few games" : pct(s.attendanceRate),
      note: attendanceNote,
    },
    {
      label: "Team wins while playing",
      value: String(s.wins),
      note: attendanceNote,
    },
    {
      label: "Runs while playing",
      value: s.runs === null ? "Too few games" : String(s.runs),
      note: coverageNote(s.liveGames, s.gamesPlayed),
    },
    { label: "Sub appearances", value: String(s.subAppearances) },
    { label: "Awards won", value: String(awards) },
  ];
}

function StatTable({ caption, rows }: { caption: string; rows: Row[] }) {
  return (
    <table className="w-full text-left">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-border">
            <th scope="row" className="py-2 pr-3 font-normal">
              {r.label}
              {r.note && (
                <span className="block text-small text-text-muted">
                  {r.note}
                </span>
              )}
            </th>
            <td className="py-2 text-right font-semibold tabular-nums">
              {r.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Stats({ searchParams }: PageProps<"/app/stats">) {
  const subject = await requireSelf("profile.edit", "/app/stats");
  const query = await searchParams;
  // Stats are per league: the one the player is looking at (ADR 0048).
  const leagueId = await activeLeagueId();
  if (!leagueId) notFound();
  const [played, won, pollWins, hidden] = await Promise.all([
    seasonsPlayedBy(db, subject.userId, leagueId),
    awardsWonBy(db, subject.userId, leagueId),
    pollWinsBy(db, subject.userId),
    isOptedOut(db, subject.userId),
  ]);
  const { seasons } = await gatherSeasons(
    db,
    played.map((p) => p.seasonId),
    { userId: subject.userId },
  );
  const perSeason = played.flatMap((p) => {
    const input = seasons.get(`${p.seasonId}|${subject.userId}`);
    if (!input) return [];
    const awards =
      won.filter((w) => w.seasonId === p.seasonId).length +
      (pollWins.get(p.seasonId) ?? 0);
    return [{ ...p, stats: seasonStats(input), awards }];
  });
  const career = careerStats(perSeason.map((s) => s.stats));
  const careerAwards = perSeason.reduce((n, s) => n + s.awards, 0);
  const saved =
    query.saved === "hidden"
      ? "You're off public leaderboards."
      : query.saved === "shown"
        ? "You're back on public leaderboards."
        : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/profile" className="underline">
          Your profile
        </Link>
        <h1 className="text-h1">Your stats</h1>
        <p className="text-text-muted">
          From what the league&apos;s app recorded: kicking orders, RSVPs, bar
          check-ins and live scores. A stat shows once at least 3 games, and at
          least half of them, recorded it. Runs are your team&apos;s runs in
          live-scored games you played.
        </p>
      </header>
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}

      {won.length > 0 && (
        <section aria-labelledby="trophies" className="flex flex-col gap-2">
          <h2 id="trophies" className="text-h2">
            Your stat awards
          </h2>
          <ul className="flex flex-col gap-1">
            {won.map((w) => (
              <li key={`${w.seasonId}-${w.award}`}>
                <Link
                  href={`/seasons/${w.seasonSlug}/awards`}
                  className="underline"
                >
                  {STAT_AWARDS[w.award].label}, {w.seasonName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {perSeason.length === 0 ? (
        <p>Your stats start once you&apos;ve played a season on a team.</p>
      ) : (
        <>
          <section aria-labelledby="career" className="flex flex-col gap-2">
            <h2 id="career" className="text-h2">
              Career
            </h2>
            <p className="text-text-muted">
              {career.seasons} season{career.seasons === 1 ? "" : "s"}
            </p>
            <StatTable
              caption="Career stats"
              rows={rowsOf(career, careerAwards)}
            />
          </section>
          {perSeason.map((s) => (
            <section
              key={s.seasonId}
              aria-labelledby={`season-${s.seasonId}`}
              className="flex flex-col gap-2"
            >
              <h2 id={`season-${s.seasonId}`} className="text-h2">
                {s.seasonName}
              </h2>
              <p className="text-text-muted">{s.teamName}</p>
              <StatTable
                caption={`${s.seasonName} stats`}
                rows={rowsOf(s.stats, s.awards)}
              />
            </section>
          ))}
        </>
      )}

      <section aria-labelledby="leaderboards" className="flex flex-col gap-3">
        <h2 id="leaderboards" className="text-h2">
          Public leaderboards
        </h2>
        <p>
          {hidden
            ? "You're off the public awards pages: you won't be listed or win a stat award. Your own stats stay here, just for you."
            : "Season awards pages list the stat leaders by first name and last initial. You can stay off them; you then can't win a stat award."}
        </p>
        <form action={setOptOutAction.bind(null, !hidden)}>
          <SubmitButton className="btn btn-secondary">
            {hidden ? "Show me on leaderboards" : "Keep me off leaderboards"}
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
