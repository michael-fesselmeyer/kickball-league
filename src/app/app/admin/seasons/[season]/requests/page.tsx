import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague, seasonSettings } from "@/db/queries/seasons";
import { seasonGameTimes, seasonRequests } from "@/db/queries/team-requests";
import { describeRequest } from "@/domain/schedule/team-requests";
import { requirePermission } from "@/lib/auth/permission";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Team scheduling requests" };

export default function SeasonRequestsPage(
  props: PageProps<"/app/admin/seasons/[season]/requests">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <SeasonRequests {...props} />
      </Suspense>
    </main>
  );
}

async function SeasonRequests({
  params,
}: PageProps<"/app/admin/seasons/[season]/requests">) {
  const { season: slug } = await params;
  await requirePermission("schedule.manage", {
    next: `/app/admin/seasons/${slug}/requests`,
  });
  const league = await currentLeague(db);
  const season = league ? await seasonSettings(db, league.id, slug) : null;
  if (!league || !season) notFound();
  const [requests, times] = await Promise.all([
    seasonRequests(db, season.id),
    seasonGameTimes(db, season.id, league.timeZone),
  ]);
  const timeLabel = (i: number) =>
    times.find((t) => t.timeIndex === i)?.label ?? `slot ${i + 1}`;
  const dateLabel = (d: string) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${d}T00:00:00Z`));
  const byTeam = new Map<string, typeof requests>();
  for (const r of requests)
    byTeam.set(r.teamName, [...(byTeam.get(r.teamName) ?? []), r]);
  const conflicts = requests.filter((r) => r.kind === "unavailable").length;
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Team scheduling requests</h1>
        <p className="text-text-muted">
          Captains send these from their team page until registration closes.
          Generating a schedule never breaks a conflict and weighs the
          preferences; the schedule screen shows how many it honored.
        </p>
        <p>
          {requests.length === 0
            ? "No requests yet."
            : `${plural(requests.length, "request", "requests")} from ${plural(byTeam.size, "team", "teams")}, including ${plural(conflicts, "conflict", "conflicts")}.`}
        </p>
        <Link
          href={`/app/admin/seasons/${slug}/schedule`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Go to the schedule
        </Link>
      </header>
      {[...byTeam].map(([teamName, rows]) => (
        <section
          key={teamName}
          aria-label={teamName}
          className="flex flex-col gap-2"
        >
          <h2 className="text-h2">{teamName}</h2>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                {describeRequest(r, timeLabel, dateLabel)}
                {r.reason && (
                  <span className="block text-text-muted">{r.reason}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
