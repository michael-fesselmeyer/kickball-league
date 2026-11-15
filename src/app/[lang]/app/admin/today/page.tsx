import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { PageLoading } from "@/components/page-loading";
import {
  RainDecisionCard,
  RainDecisionCardLoading,
} from "@/components/rain-decision-card";
import { db } from "@/db/client";
import type { CommandDayRow } from "@/db/queries/command-center";
import type { LeagueId } from "@/domain/ids";
import type { ParkGames } from "@/db/queries/rainout-decision";
import { gamesNeedingRef } from "@/db/queries/referee-cover";
import { gameForecast, rainRisk } from "@/domain/weather/forecast";
import { HandoversCard } from "@/components/handovers-card";
import { loadHandovers } from "@/lib/gameday/handovers";
import { requirePermission } from "@/lib/auth/permission";
import { featureEnabled } from "@/lib/platform/site";
import { cachedForecast } from "@/lib/weather";
import { CommandBoard } from "./board";
import { DayFields } from "./fields";
import { DayGear } from "./gear";
import { loadCommand, parseDay } from "./load";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Game day" };

/**
 * The game-day command center: one phone screen for the admins at the park
 * (issue #257). Every game of the day with its field, ref and check-in and
 * score; the weather; one tap to a rain-out or an announcement. The games
 * refresh on their own every ten seconds.
 */
export default function GameDayPage(
  props: PageProps<"/[lang]/app/admin/today">,
) {
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

async function GameDay({ searchParams }: PageProps<"/[lang]/app/admin/today">) {
  await requirePermission("season.manage", { next: "/app/admin/today" });
  const query = await searchParams;
  const league = await activeLeague();
  const now = new Date();
  const [found, needRef] = league
    ? await Promise.all([
        loadCommand(league.id, now, parseDay(query.date)),
        gamesNeedingRef(db, { leagueId: league.id, now }),
      ])
    : [null, []];
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
        <HelpLink
          audience="admin"
          article="command-center"
          topic="the game-day command center"
        />
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
            href={`${base}/status?date=${state.date}`}
            className="btn btn-secondary"
          >
            Set the day&apos;s status
          </Link>
          <Link
            href={`${base}/rainout?date=${state.date}`}
            className="btn btn-secondary"
          >
            Call a rain-out
          </Link>
          <Link
            href={`${base}/game-day-checklist`}
            className="btn btn-secondary"
          >
            Game-day checklist
          </Link>
          <Link href={`${base}/announcements`} className="btn btn-secondary">
            Send an announcement
          </Link>
          <Link href={`${base}/referees`} className="btn btn-secondary">
            Assign refs
          </Link>
          <Link
            href={`/app/admin/today/print?date=${state.date}`}
            className="btn btn-secondary"
          >
            Print game-day pack
          </Link>
        </nav>
      </header>
      {needRef.length > 0 && (
        <section
          aria-labelledby="need-ref"
          className="flex flex-col gap-2 rounded-lg border border-danger p-3"
        >
          <h2 id="need-ref" className="text-h3">
            No ref yet, starting within a day
          </h2>
          <ul className="flex flex-col">
            {needRef.map((g) => (
              <li
                key={g.gameId}
                className="flex flex-wrap items-baseline justify-between gap-2 py-1"
              >
                <span>
                  {g.teamAName} vs {g.teamBName}
                  <span className="block text-small text-text-muted">
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: league.timeZone,
                    }).format(g.startsAt)}{" "}
                    · {g.fieldName}
                  </span>
                </span>
                <Link
                  href={`/app/admin/seasons/${g.seasonSlug}/referees/assign`}
                  className="min-h-11 underline"
                >
                  Find a ref
                  <span className="sr-only">
                    {" "}
                    for {g.teamAName} vs {g.teamBName}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-small text-text-muted">
            The league&rsquo;s refs who are free then are asked when a ref drops
            out and each morning; the first to tap &ldquo;Take it&rdquo; gets
            the game.
          </p>
        </section>
      )}
      {state.date >= todayDate && (await featureEnabled("weather")) && (
        <Suspense fallback={<RainDecisionCardLoading />}>
          <RainDecisionCard parks={dayParks(rows)} timeZone={league.timeZone} />
        </Suspense>
      )}
      <Suspense
        fallback={
          <p className="min-h-11 text-text-muted">Checking the fields…</p>
        }
      >
        <DayHandovers
          leagueId={league.id}
          date={state.date}
          timeZone={league.timeZone}
          now={now}
          rows={rows}
        />
      </Suspense>
      <CommandBoard initial={state} timeZone={league.timeZone} />
      <Suspense fallback={<p className="min-h-24">Checking the fields…</p>}>
        <DayFields
          leagueId={league.id}
          seasonSlug={seasonSlug}
          date={state.date}
          timeZone={league.timeZone}
        />
      </Suspense>
      <Suspense fallback={<p className="min-h-24">Checking the gear…</p>}>
        <DayGear
          leagueId={league.id}
          date={state.date}
          timeZone={league.timeZone}
        />
      </Suspense>
    </>
  );
}

/** Who uses each field next, and the countdown to the handover (issue #408). */
async function DayHandovers(input: {
  leagueId: LeagueId;
  date: string;
  timeZone: string;
  now: Date;
  rows: readonly CommandDayRow[];
}) {
  const fields = await loadHandovers({ ...input, forAdmin: true });
  return (
    <HandoversCard
      fields={fields}
      renderedAt={input.now.toISOString()}
      timeZone={input.timeZone}
    />
  );
}

/** The day's games still on, by park, for the rain-out decision card. */
function dayParks(rows: readonly CommandDayRow[]): ParkGames[] {
  const parks = new Map<string, ParkGames>();
  for (const r of rows) {
    if (!r.venue || r.slotCancelled || r.status === "cancelled") continue;
    const park = parks.get(r.venue.name) ?? {
      venue: r.venue.name,
      lat: r.venue.lat,
      lng: r.venue.lng,
      games: [],
    };
    park.games.push({ startsAt: r.startsAt, endsAt: r.endsAt });
    parks.set(r.venue.name, park);
  }
  return [...parks.values()];
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
