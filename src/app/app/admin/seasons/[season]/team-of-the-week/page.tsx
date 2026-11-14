import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { publishedSchedule } from "@/db/queries/public-schedule";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { managedSponsors, teamsOfWeek } from "@/db/queries/sponsors";
import { formatCents } from "@/domain/registration/pricing";
import { dayHeading } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import {
  suggestionReason,
  suggestTeamsOfWeek,
  TEAM_OF_WEEK_ERRORS,
} from "@/domain/sponsors/team-of-week";
import { statGamesFrom, teamsFrom } from "@/domain/stats/season";
import { gameDays } from "@/domain/stats/weekly";
import { requirePermission } from "@/lib/auth/permission";
import { removeTeamOfWeekAction, setTeamOfWeekAction } from "./actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Team of the week" };

type Props = PageProps<"/app/admin/seasons/[season]/team-of-the-week">;

export default function TeamOfWeekPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <TeamOfWeek {...props} />
      </Suspense>
    </main>
  );
}

const input = "rounded-md border border-border bg-surface px-2 py-1";

const NOTICES: Record<string, string> = {
  saved: "Saved. It's on the sponsors page now.",
  removed: "Removed.",
};

async function TeamOfWeek({ params, searchParams }: Props) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/team-of-the-week`;
  await requirePermission("season.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const [schedule, honors, sponsors] = await Promise.all([
    publishedSchedule(db, season.id),
    teamsOfWeek(db, season.id),
    managedSponsors(db, season.leagueId, "all"),
  ]);
  const dayOf = (d: Date) => localDay(d, season.timeZone);
  const days = gameDays(schedule, season.timeZone);
  const day =
    typeof query.day === "string" && days.includes(query.day)
      ? query.day
      : days[0];
  const teams = teamsFrom(schedule);
  const games = statGamesFrom(schedule);
  const suggestions = day
    ? suggestTeamsOfWeek([...teams.keys()], games, day, dayOf)
    : [];
  const existing = honors.find((h) => h.weekOf === day);
  const pickSlug =
    typeof query.pick === "string" ? query.pick : suggestions[0]?.team;
  const picked = suggestions.find((s) => s.team === pickSlug);
  const nameOf = (teamSlug: string) => teams.get(teamSlug)?.name ?? teamSlug;
  const defaultTeam = existing
    ? existing.teamSeasonId
    : picked
      ? teams.get(picked.team)?.id
      : undefined;
  const defaultReason = existing
    ? existing.reason
    : picked
      ? suggestionReason(picked, nameOf(picked.opponent))
      : "";
  const homeBar = sponsors.find((s) => s.isHomeBar);
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const error =
    typeof query.error === "string"
      ? TEAM_OF_WEEK_ERRORS[query.error as keyof typeof TEAM_OF_WEEK_ERRORS]
      : undefined;
  const sortedTeams = [...teams.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Team of the week</h1>
        <p className="text-text-muted">
          Name a team for each game day. It shows on the sponsors page and the
          sponsor&apos;s page, with the tab if a sponsor puts one up.
        </p>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {!day ? (
        <p className="text-text-muted">
          No results yet. Come back after the first game day.
        </p>
      ) : (
        <>
          <nav aria-label="Game days">
            <ul className="flex flex-wrap gap-2">
              {days.map((d) => (
                <li key={d}>
                  <Link
                    href={`${page}?day=${d}`}
                    aria-current={d === day ? "page" : undefined}
                    className={`btn ${d === day ? "btn-primary" : "btn-secondary"}`}
                  >
                    {dayHeading(d).replace(/^\w+, /, "")}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-labelledby="suggested" className="flex flex-col gap-3">
            <h2 id="suggested" className="text-h2">
              Best wins on {dayHeading(day)}
            </h2>
            {suggestions.length === 0 ? (
              <p className="text-text-muted">No decided games that day.</p>
            ) : (
              <ol className="flex flex-col">
                {suggestions.map((s) => (
                  <li
                    key={s.gameId}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
                  >
                    <span>
                      <strong>{nameOf(s.team)}</strong>
                      <span className="block text-small text-text-muted">
                        {suggestionReason(s, nameOf(s.opponent))}
                      </span>
                    </span>
                    <Link
                      href={`${page}?day=${day}&pick=${s.team}#name-team`}
                      className="inline-flex min-h-6 items-center underline"
                    >
                      Use<span className="sr-only">: {nameOf(s.team)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="name-team" className="flex flex-col gap-3">
            <h2 id="name-team" className="text-h2">
              {existing ? "Change the pick" : "Name the team"}
            </h2>
            <form
              key={`${day}-${pickSlug ?? ""}`}
              action={setTeamOfWeekAction.bind(null, slug)}
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="day" value={day} />
              <label className="flex flex-col gap-1">
                Team
                <select
                  name="team"
                  required
                  defaultValue={defaultTeam ?? ""}
                  className={`${input} self-start`}
                >
                  <option value="" disabled>
                    Pick a team
                  </option>
                  {sortedTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                Why they earned it
                <textarea
                  name="reason"
                  required
                  maxLength={280}
                  rows={2}
                  defaultValue={defaultReason}
                  className={input}
                />
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1">
                  Tab from (optional)
                  <select
                    name="sponsor"
                    defaultValue={
                      existing
                        ? (existing.sponsorId ?? "")
                        : (homeBar?.id ?? "")
                    }
                    className={input}
                  >
                    <option value="">No sponsor</option>
                    {sponsors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Tab in dollars (optional)
                  <input
                    name="tab"
                    inputMode="decimal"
                    defaultValue={
                      existing?.tabCents ? String(existing.tabCents / 100) : ""
                    }
                    placeholder="50"
                    className={`${input} w-28`}
                  />
                </label>
              </div>
              <button type="submit" className="btn self-start btn-primary">
                {existing ? "Save the change" : "Name them"}
              </button>
            </form>
          </section>
        </>
      )}

      <section aria-labelledby="past" className="flex flex-col gap-3">
        <h2 id="past" className="text-h2">
          This season
        </h2>
        {honors.length === 0 ? (
          <p className="text-text-muted">Nobody named yet.</p>
        ) : (
          <ul className="flex flex-col">
            {honors.map((h) => (
              <li
                key={h.weekOf}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
              >
                <span>
                  <strong>{h.teamName}</strong> · {dayHeading(h.weekOf)}
                  <span className="block text-small text-text-muted">
                    {h.reason}
                    {h.tabCents !== null &&
                      h.sponsorName &&
                      ` ${formatCents(h.tabCents)} tab at ${h.sponsorName}.`}
                  </span>
                </span>
                <form
                  action={removeTeamOfWeekAction.bind(null, slug, h.weekOf)}
                >
                  <button
                    type="submit"
                    className="inline-flex min-h-6 items-center underline"
                  >
                    Remove
                    <span className="sr-only">
                      : {h.teamName}, {dayHeading(h.weekOf)}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
