import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import {
  sponsorBySlug,
  sponsorDeals,
  sponsorTopTeams,
  sponsorWeeklyCounts,
} from "@/db/queries/sponsors";
import { localDay } from "@/domain/schedule/public-game";
import { reportStart, weekLabel, weeklyReport } from "@/domain/sponsors/report";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Weekly numbers" };

type Props = PageProps<"/app/sponsor/[sponsor]/report">;

const WEEKS = 8;

/** What the league brought in, week by week, for the sponsor and admins. */
export default function ReportPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Counting…</p>}>
        <Report {...props} />
      </Suspense>
    </main>
  );
}

function Change({ by }: { by: number | null }) {
  if (by === null || by === 0)
    return <span className="text-text-muted">Same as last week</span>;
  return (
    <span className="text-text-muted">
      <span aria-hidden="true">{by > 0 ? "▲" : "▼"} </span>
      {Math.abs(by)} {by > 0 ? "more" : "fewer"} than last week
    </span>
  );
}

async function Report({ params }: Props) {
  const { sponsor: slug } = await params;
  const page = `/app/sponsor/${slug}/report`;
  const sponsor = await sponsorBySlug(db, slug);
  if (!sponsor) notFound();
  await requirePermission("sponsor.report", {
    next: page,
    sponsorId: sponsor.id,
  });
  const league = await currentLeague(db);
  const today = localDay(new Date(), league?.timeZone ?? "America/New_York");
  const from = reportStart(today, WEEKS);
  const [counts, teams, deals] = await Promise.all([
    sponsorWeeklyCounts(db, sponsor.id, from),
    sponsorTopTeams(db, sponsor.id, from),
    sponsorDeals(db, sponsor.id),
  ]);
  const report = weeklyReport(counts.weeks, counts.deals, today, WEEKS);
  const [thisWeek] = report.weeks;
  const dealName = new Map(deals.map((d) => [d.id as string, d.title]));
  const dealTotals = new Map<string, { total: number; thisWeek: number }>();
  for (const week of report.weeks)
    for (const d of week.deals) {
      const t = dealTotals.get(d.dealId) ?? { total: 0, thisWeek: 0 };
      t.total += d.count;
      if (week === thisWeek) t.thisWeek += d.count;
      dealTotals.set(d.dealId, t);
    }
  const peak = Math.max(1, ...report.weeks.map((w) => w.checkIns));
  const oldestFirst = [...report.weeks].reverse();

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/app/sponsor/${slug}`} className="underline">
          {sponsor.name}
        </Link>
        <h1 className="text-h1">Weekly numbers</h1>
        <p className="text-text-muted">
          Players who checked in with the league&apos;s code, the last {WEEKS}{" "}
          weeks. Weeks run Monday to Sunday. Names stay private; these are
          counts.
        </p>
      </header>

      <section aria-labelledby="this-week" className="flex flex-col gap-3">
        <h2 id="this-week" className="text-h2">
          {thisWeek ? weekLabel(thisWeek.weekOf) : "This week"}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            [
              "Check-ins",
              thisWeek?.checkIns ?? 0,
              <Change key="c" by={report.change} />,
            ],
            ["Different players", thisWeek?.players ?? 0, null],
            ["Deals used", thisWeek?.dealsUsed ?? 0, null],
          ].map(([label, value, extra]) => (
            <div
              key={String(label)}
              className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4 shadow-card"
            >
              <dt className="text-small text-text-muted">{label}</dt>
              <dd className="font-display text-h1">{value}</dd>
              {extra && <dd className="text-small">{extra}</dd>}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="by-week" className="flex flex-col gap-4">
        <h2 id="by-week" className="text-h2">
          Check-ins by week
        </h2>
        {/* The table below carries the same numbers for screen readers. */}
        <div
          aria-hidden="true"
          className="flex h-40 items-end gap-2 border-b border-border-strong"
        >
          {oldestFirst.map((w) => (
            <div
              key={w.weekOf}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-micro">{w.checkIns}</span>
              <div
                className="w-full rounded-t bg-brand"
                style={{ height: `${(w.checkIns / peak) * 100}%` }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="-mt-2 flex gap-2">
          {oldestFirst.map((w) => (
            <span
              key={w.weekOf}
              className="flex-1 text-center text-micro text-text-muted"
            >
              {weekLabel(w.weekOf).replace("Week of ", "")}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left">
            <caption className="sr-only">
              Check-ins, players, teams and deals used by week, newest first
            </caption>
            <thead className="text-text-muted">
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Check-ins</th>
                <th scope="col">Players</th>
                <th scope="col">Teams</th>
                <th scope="col">Deals used</th>
              </tr>
            </thead>
            <tbody>
              {report.weeks.map((w) => (
                <tr key={w.weekOf} className="border-t border-border">
                  <th scope="row" className="py-2 font-normal">
                    {weekLabel(w.weekOf)}
                  </th>
                  <td>{w.checkIns}</td>
                  <td>{w.players}</td>
                  <td>{w.teams}</td>
                  <td>{w.dealsUsed}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-strong font-bold">
                <th scope="row" className="py-2">
                  {WEEKS} weeks
                </th>
                <td>{report.totals.checkIns}</td>
                <td colSpan={2} />
                <td>{report.totals.dealsUsed}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section aria-labelledby="deals" className="flex flex-col gap-3">
        <h2 id="deals" className="text-h2">
          Deals used
        </h2>
        {dealTotals.size === 0 ? (
          <p className="text-text-muted">No deals used in these weeks yet.</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-text-muted">
              <tr>
                <th scope="col">Deal</th>
                <th scope="col">This week</th>
                <th scope="col">{WEEKS} weeks</th>
              </tr>
            </thead>
            <tbody>
              {[...dealTotals]
                .sort((a, b) => b[1].total - a[1].total)
                .map(([id, t]) => (
                  <tr key={id} className="border-t border-border">
                    <th scope="row" className="py-2 font-normal">
                      {dealName.get(id) ?? "A removed deal"}
                    </th>
                    <td>{t.thisWeek}</td>
                    <td>{t.total}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="teams" className="flex flex-col gap-3">
        <h2 id="teams" className="text-h2">
          Teams that came by most
        </h2>
        {teams.length === 0 ? (
          <p className="text-text-muted">
            Teams show up here once players check in.
          </p>
        ) : (
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {teams.map((t) => (
              <li key={t.name}>
                {t.name}{" "}
                <span className="text-text-muted">
                  ({t.checkIns} {t.checkIns === 1 ? "check-in" : "check-ins"})
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
