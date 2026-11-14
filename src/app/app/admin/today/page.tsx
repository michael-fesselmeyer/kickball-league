import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import type { CommandDayRow } from "@/db/queries/command-center";
import { currentLeague } from "@/db/queries/seasons";
import { gameForecast, rainRisk } from "@/domain/weather/forecast";
import { requirePermission } from "@/lib/auth/permission";
import { featureEnabled } from "@/lib/platform/site";
import { cachedForecast } from "@/lib/weather";
import { CommandBoard } from "./board";
import { loadCommand, parseDay } from "./load";

export const metadata: Metadata = { title: "Game day" };

/**
 * The game-day command center: one phone screen for the admins at the park
 * (issue #257). Every game of the day with its field, ref and check-in and
 * score; the weather; one tap to a rain-out or an announcement. The games
 * refresh on their own every ten seconds.
 */
export default function GameDayPage(props: PageProps<"/app/admin/today">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading game day…</PageLoading>}>
        <GameDay {...props} />
      </Suspense>
    </main>
  );
}

const NOTICES: Record<string, string> = {
  checked_in: "Ref marked as at the field.",
};

async function GameDay({ searchParams }: PageProps<"/app/admin/today">) {
  await requirePermission("season.manage", { next: "/app/admin/today" });
  const query = await searchParams;
  const league = await currentLeague(db);
  const now = new Date();
  const found = league
    ? await loadCommand(league.id, now, parseDay(query.date))
    : null;
  if (!league || !found)
    return (
      <>
        <h1 className="text-h1">Game day</h1>
        <p>No games on the calendar from today on.</p>
        <p>
          <Link href="/app/admin" className="underline">
            Back to admin
          </Link>
        </p>
      </>
    );
  const { state, rows } = found;
  const todayDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: league.timeZone,
  }).format(now);
  const when =
    state.date === todayDate
      ? "Today"
      : state.date > todayDate
        ? "Next game day"
        : "Past game day";
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${state.date}T12:00:00Z`));
  // A day's games are one season's in practice; links go to the first one.
  const seasonSlug = rows[0]?.seasonSlug;
  const base = seasonSlug ? `/app/admin/seasons/${seasonSlug}` : "/app/admin";
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">
          {when} · {label}
        </p>
        <h1 className="text-h1">Game day</h1>
        {notice && (
          <p role="status" className="rounded-lg border border-success p-3">
            {notice}
          </p>
        )}
        <Suspense
          fallback={
            <p className="min-h-11 text-text-muted">Checking the weather…</p>
          }
        >
          <DayWeather rows={rows} />
        </Suspense>
        <nav aria-label="Game day actions" className="flex flex-wrap gap-2">
          <Link
            href={`${base}/rainout?date=${state.date}`}
            className="btn btn-secondary"
          >
            Call a rain-out
          </Link>
          <Link href={`${base}/announcements`} className="btn btn-secondary">
            Send an announcement
          </Link>
          <Link href={`${base}/referees`} className="btn btn-secondary">
            Assign refs
          </Link>
        </nav>
      </header>
      <CommandBoard initial={state} timeZone={league.timeZone} />
    </>
  );
}

/**
 * The day's weather at the park: temperature at the first kickoff and the
 * rain risk over the game hours, from the cached National Weather Service
 * forecast. Nothing when the weather feature is off or the forecast can't
 * be had; the games never wait for it.
 */
async function DayWeather({ rows }: { rows: readonly CommandDayRow[] }) {
  const playing = rows.filter(
    (r) => !r.slotCancelled && r.status !== "cancelled",
  );
  const first = playing[0];
  const place = playing.find((r) => r.venue)?.venue;
  if (!first || !place || !(await featureEnabled("weather")))
    return <p className="min-h-11" />;
  const hours = await cachedForecast(place.lat, place.lng);
  if (!hours) return <p className="min-h-11" />;
  const risk = rainRisk(hours, playing);
  const kickoff = gameForecast(hours, first);
  if (risk.covered === 0 || !kickoff) return <p className="min-h-11" />;
  const words =
    risk.level === "likely"
      ? "Rain likely"
      : risk.level === "watch"
        ? "Rain possible"
        : "Low chance of rain";
  return (
    <p className="flex min-h-11 flex-wrap items-center gap-2">
      <span className="sticker inline-flex items-center gap-2 tabular-nums">
        <span aria-hidden="true">
          {risk.thunder ? "⛈️" : risk.level === "low" ? "🌤️" : "🌧️"}
        </span>
        {kickoff.temperatureF}°F · {words}, up to {risk.peakChance}%
        {risk.thunder ? " · thunderstorms" : ""}
      </span>
      <span className="text-small text-text-muted">
        National Weather Service
      </span>
    </p>
  );
}
