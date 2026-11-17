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
  props: PageProps<"/[lang]/app/admin/seasons/[season]">,
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
}: PageProps<"/[lang]/app/admin/seasons/[season]">) {
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
      </header>
      <SeasonTools slug={slug} />
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

type Tool = [path: string, label: string];

/**
 * The season's tools, grouped the way the admin home groups the league's
 * (AdminTools). Each group folds away, so the page opens on its four
 * headings rather than a wall of links.
 */
const SEASON_TOOL_GROUPS: { title: string; tools: Tool[] }[] = [
  {
    title: "Setup",
    tools: [
      ["fields", "Fields and permits"],
      ["divisions", "Divisions"],
      ["schedule", "Schedule"],
      ["playoffs", "Playoffs"],
      ["starts", "Start times"],
      ["checklist", "Checklist"],
      ["rollover", "Start the next season from this one"],
    ],
  },
  {
    title: "Players and money",
    tools: [
      ["registrations", "Registrations"],
      ["promo-codes", "Promo codes"],
      ["waitlist", "Waitlist"],
      ["rebates", "Rain-out rebates"],
      ["free-agents", "Free-agent matcher"],
      ["requests", "Team requests"],
      ["new-teams", "New-team requests"],
    ],
  },
  {
    title: "Game day",
    tools: [
      ["status", "Game-day status"],
      ["scores", "Scores"],
      ["referees", "Referees"],
      ["rainout", "Rain-out"],
      ["attendance", "Attendance"],
      ["sportsmanship", "Sportsmanship"],
      ["game-day-checklist", "Game-day checklist"],
    ],
  },
  {
    title: "Engagement",
    tools: [
      ["announcements", "Announcements"],
      ["recap", "Weekly recap"],
      ["team-of-the-week", "Team of the week"],
      ["awards", "Awards"],
      ["captain-polls", "Captains' polls"],
      ["cards", "Season cards"],
      ["survey", "Season survey"],
      ["challenge", "Sign-up challenge"],
      ["win-back", "Win back past players"],
      ["leadership", "Leadership check-ins"],
      ["shirts", "Shirts"],
      ["shirt-order", "Shirt order"],
    ],
  },
];

function SeasonTools({ slug }: { slug: string }) {
  return (
    <nav aria-label="Season tools" className="flex flex-col gap-2">
      {SEASON_TOOL_GROUPS.map((group) => (
        <details
          key={group.title}
          className="group rounded-card border-2 border-text bg-surface"
        >
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 font-bold">
            <span>
              {group.title}{" "}
              <span className="font-normal text-text-muted">
                ({group.tools.length})
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-text-muted transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <ul className="grid border-t border-border px-4 pb-2 sm:grid-cols-2 sm:gap-x-6">
            {group.tools.map(([path, label]) => (
              <li key={path}>
                <Link
                  href={`/app/admin/seasons/${slug}/${path}`}
                  prefetch={false}
                  className="flex min-h-11 items-center border-b border-border hover:underline"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}
