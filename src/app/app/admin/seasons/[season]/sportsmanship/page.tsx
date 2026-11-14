import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonSportsmanship } from "@/db/queries/discipline";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { averageOf } from "@/domain/discipline/discipline";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Sportsmanship" };

export default function SportsmanshipPage(
  props: PageProps<"/app/admin/seasons/[season]/sportsmanship">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading ratings…</PageLoading>}>
        <Ratings {...props} />
      </Suspense>
    </main>
  );
}

async function Ratings({
  params,
}: PageProps<"/app/admin/seasons/[season]/sportsmanship">) {
  await requireFeature("discipline");
  const { season: slug } = await params;
  await requirePermission("sportsmanship.view", {
    next: `/app/admin/seasons/${slug}/sportsmanship`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const teams = await seasonSportsmanship(db, season.id);
  // Lowest average first: the teams worth a word come to the top.
  const ranked = [...teams].sort(
    (a, b) =>
      (averageOf(a.scores) ?? 6) - (averageOf(b.scores) ?? 6) ||
      a.name.localeCompare(b.name),
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Sportsmanship</h1>
        <p className="text-text-muted">
          After each final score, both captains rate the other team from 1 to 5.
          Here are each team&apos;s average and the notes left for admins,
          without saying which game or team they came from.
        </p>
      </header>
      {ranked.length === 0 ? (
        <p className="text-text-muted">No teams in this season yet.</p>
      ) : (
        <ul className="flex flex-col">
          {ranked.map((t) => {
            const average = averageOf(t.scores);
            return (
              <li
                key={t.teamSeasonId}
                className="flex flex-col gap-1 border-t border-border py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong>{t.name}</strong>
                  <span className="tabular-nums">
                    {average === null
                      ? "Not rated yet"
                      : `${average.toFixed(1)} from ${t.scores.length} ${t.scores.length === 1 ? "game" : "games"}`}
                  </span>
                </div>
                {t.notes.length > 0 && (
                  <ul className="list-disc pl-5 text-small">
                    {t.notes.map((n, i) => (
                      <li key={i}>“{n}”</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
