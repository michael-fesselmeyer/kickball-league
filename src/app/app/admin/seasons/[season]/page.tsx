import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague, seasonSettings } from "@/db/queries/seasons";
import { toSeasonForm } from "@/domain/season/settings";
import { requirePermission } from "@/lib/auth/permission";
import { updateSeasonAction } from "../actions";
import { SeasonSettingsForm } from "../season-form";

export const metadata: Metadata = { title: "Season settings" };

export default function SeasonPage(
  props: PageProps<"/app/admin/seasons/[season]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Season {...props} />
      </Suspense>
    </main>
  );
}

async function Season({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}`,
  });
  const league = await currentLeague(db);
  const season = league ? await seasonSettings(db, league.id, slug) : null;
  if (!league || !season) notFound();

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/seasons" className="underline">
          All seasons
        </Link>
        <h1 className="text-h1">{season.name}</h1>
        <p className="flex flex-wrap gap-4">
          <Link
            href={`/app/admin/seasons/${slug}/fields`}
            className="underline"
          >
            Fields and permits
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/schedule`}
            className="underline"
          >
            Schedule
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/registrations`}
            className="underline"
          >
            Registrations
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/scores`}
            className="underline"
          >
            Scores
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/referees`}
            className="underline"
          >
            Referees
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/announcements`}
            className="underline"
          >
            Announcements
          </Link>
          <Link href={`/app/admin/seasons/${slug}/recap`} className="underline">
            Weekly recap
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/playoffs`}
            className="underline"
          >
            Playoffs
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/shirts`}
            className="underline"
          >
            Shirts
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/requests`}
            className="underline"
          >
            Team requests
          </Link>
        </p>
      </header>
      {(query.created || query.saved) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.created
            ? "Season created as a draft. Add its fields and permits next."
            : "Saved."}
        </p>
      )}
      <SeasonSettingsForm
        action={updateSeasonAction.bind(null, slug)}
        values={toSeasonForm(season, league.timeZone)}
        status={season.status}
        submitLabel="Save changes"
      />
    </>
  );
}
