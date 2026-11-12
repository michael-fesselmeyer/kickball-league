import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnnouncementForm } from "@/components/announcements";
import { db } from "@/db/client";
import { DAILY_LIMIT, teamsToAnnounceTo } from "@/db/queries/announcements";
import {
  allPublishedGames,
  publishedSchedule,
} from "@/db/queries/public-schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { dayHeading } from "@/domain/schedule/format";
import { statGamesFrom } from "@/domain/stats/season";
import { gameDays, recapDraft } from "@/domain/stats/weekly";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { sendLeagueAnnouncementAction } from "../announcements/actions";

export const metadata: Metadata = { title: "Weekly recap" };

export default function RecapPage(
  props: PageProps<"/app/admin/seasons/[season]/recap">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Recap {...props} />
      </Suspense>
    </main>
  );
}

async function Recap({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/recap">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("announcement.send", {
    next: `/app/admin/seasons/${slug}/recap`,
    scope: "league",
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const [schedule, everything, teams] = await Promise.all([
    publishedSchedule(db, season.id),
    allPublishedGames(db),
    teamsToAnnounceTo(db, season.id),
  ]);
  const days = gameDays(schedule, season.timeZone);
  const day =
    (typeof query.day === "string" && days.includes(query.day)
      ? query.day
      : days[0]) ?? null;
  const draft =
    day === null
      ? null
      : recapDraft({
          seasonName: season.name,
          schedule,
          history: statGamesFrom(everything),
          day,
          timeZone: season.timeZone,
          link: absoluteUrl(
            siteOrigin(env.BETTER_AUTH_URL),
            `/seasons/${season.slug}/standings`,
          ),
        });

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Weekly recap</h1>
        <p className="text-text-muted">
          A draft written from the final scores, power rankings, streaks and
          records. Make it yours, then send it as an announcement.
        </p>
      </header>

      {day === null || draft === null ? (
        <p className="text-text-muted">
          No final scores yet. The draft appears after the first game day.
        </p>
      ) : (
        <>
          {days.length > 1 && (
            <nav aria-label="Game days" className="flex flex-wrap gap-2">
              {days.map((d) => (
                <Link
                  key={d}
                  href={`/app/admin/seasons/${slug}/recap?day=${d}`}
                  aria-current={d === day ? "page" : undefined}
                  className={`btn ${d === day ? "btn-primary" : "btn-secondary"}`}
                >
                  {dayHeading(d)}
                </Link>
              ))}
            </nav>
          )}
          <section aria-labelledby="draft" className="flex flex-col gap-3">
            <h2 id="draft" className="text-h2">
              Recap for {dayHeading(day)}
            </h2>
            <AnnouncementForm
              key={day}
              action={sendLeagueAnnouncementAction.bind(null, slug)}
              audience={[
                { value: "league", label: `Everyone in ${season.name}` },
                ...teams.map((t) => ({ value: t.id, label: t.name })),
              ]}
              limitNote={`Nothing goes out until you send it. Up to ${DAILY_LIMIT.admin} announcements a day.`}
              defaults={draft}
            />
          </section>
        </>
      )}
    </>
  );
}
