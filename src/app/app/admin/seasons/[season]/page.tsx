import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonSettings } from "@/db/queries/seasons";
import { toSeasonForm } from "@/domain/season/settings";
import { requirePermission } from "@/lib/auth/permission";
import { updateSeasonAction } from "../actions";
import { SeasonSettingsForm } from "../season-form";
import { PageLoading } from "@/components/page-loading";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Season settings" };

export default function SeasonPage(
  props: PageProps<"/app/admin/seasons/[season]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
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
  const league = await activeLeague();
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
            href={`/app/admin/seasons/${slug}/divisions`}
            className="underline"
          >
            Divisions
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
            href={`/app/admin/seasons/${slug}/promo-codes`}
            className="underline"
          >
            Promo codes
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/waitlist`}
            className="underline"
          >
            Waitlist
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/rebates`}
            className="underline"
          >
            Rain-out rebates
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/free-agents`}
            className="underline"
          >
            Free-agent matcher
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
            href={`/app/admin/seasons/${slug}/survey`}
            className="underline"
          >
            Season survey
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/win-back`}
            className="underline"
          >
            Win back past players
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/requests`}
            className="underline"
          >
            Team requests
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/new-teams`}
            className="underline"
          >
            New-team requests
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/awards`}
            className="underline"
          >
            Awards
          </Link>
          <Link href={`/app/admin/seasons/${slug}/cards`} className="underline">
            Season cards
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/sportsmanship`}
            className="underline"
          >
            Sportsmanship
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/challenge`}
            className="underline"
          >
            Sign-up challenge
          </Link>
          <Link
            href={`/app/admin/seasons/${slug}/rollover`}
            className="underline"
          >
            Start the next season from this one
          </Link>
        </p>
      </header>
      {typeof query.rolled === "string" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Season created as a draft from the last one, with {query.rolled}{" "}
          {query.rolled === "1" ? "team" : "teams"}. Captains still sign the
          waiver and pay; apply for the permits before opening registration.
        </p>
      )}
      {(query.created || query.saved) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.created
            ? "Season created as a draft. Add its fields and permits, and choose its waiver, next."
            : "Saved."}
        </p>
      )}
      {!season.hasWaiver && (
        <p className="rounded-lg border border-warning p-3">
          This season has no waiver yet. Players sign it before they can pay, so
          registration can&apos;t open without one.{" "}
          <Link href="/app/admin/waivers" className="underline">
            Choose its waiver
          </Link>
          .
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
