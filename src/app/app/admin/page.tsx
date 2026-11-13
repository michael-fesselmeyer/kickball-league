import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  dashboardSeason,
  type GameDay,
  type GameDayGame,
  type GameDayTeam,
  type GroupSummary,
  missingScores,
  nextGameDay,
  otherSeasons,
  registrationSummary,
} from "@/db/queries/admin-dashboard";
import { pendingNewTeamCount } from "@/db/queries/new-teams";
import type { FieldingLevel } from "@/domain/rsvp/fielding";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "League admin" };

export default function AdminHomePage(props: PageProps<"/app/admin">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Dashboard {...props} />
      </Suspense>
    </main>
  );
}

const SEASON_STATUS: Record<string, string> = {
  draft: "Draft",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  in_progress: "In progress",
  playoffs: "Playoffs",
  completed: "Completed",
};

const TEAM_STATUS: Record<string, string> = {
  forming: "Forming",
  pending_payment: "Waiting on payment",
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
};

type Tone = "success" | "warning" | "danger" | "muted";

const DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-border-strong",
};

const FIELDING: Record<FieldingLevel, { tone: Tone; label: string }> = {
  full: { tone: "success", label: "Full lineup" },
  short: { tone: "warning", label: "Short-handed" },
  check: { tone: "warning", label: "Check the lineup" },
  forfeit: { tone: "danger", label: "Forfeit risk" },
};

const SCORE_STATE: Record<string, string> = {
  none: "No score reported",
  awaiting: "Waiting for the other team to confirm",
  disputed: "Disputed",
};

/** Color never carries meaning alone: the dot always sits beside its words. */
function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${DOT[tone]}`}
      />
      <span>{children}</span>
    </span>
  );
}

async function Dashboard({ searchParams }: PageProps<"/app/admin">) {
  const subject = await requirePermission("season.manage", {
    next: "/app/admin",
  });
  const isOwner = subject.globalRole === "owner";
  const query = await searchParams;
  const now = new Date();
  const current = await dashboardSeason(
    db,
    now,
    typeof query.season === "string" ? query.season : undefined,
  );
  if (!current) {
    if (typeof query.season === "string") notFound();
    return (
      <>
        <h1 className="text-h1">League admin</h1>
        <p>No seasons yet. Set one up to open registration.</p>
        <p className="flex flex-wrap gap-3">
          <Link href="/app/admin/seasons/new" className="btn btn-primary">
            New season
          </Link>
          <Link href="/app/admin/waivers" className="btn btn-secondary">
            Waivers
          </Link>
          <Link href="/app/admin/events" className="btn btn-secondary">
            Events
          </Link>
        </p>
      </>
    );
  }

  const [day, missing, registrations, others, newTeams] = await Promise.all([
    nextGameDay(db, current, now),
    missingScores(db, current, now),
    registrationSummary(db, current.id),
    otherSeasons(db, current.id),
    pendingNewTeamCount(db, current.id),
  ]);
  const base = `/app/admin/seasons/${current.slug}`;
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: current.timeZone,
    }).format(d);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: current.timeZone,
    }).format(d);

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
          League admin
        </p>
        <h1 className="text-h1">{current.name}</h1>
        <p className="text-text-muted">
          {SEASON_STATUS[current.status] ?? current.status}
          {others.length > 0 && (
            <>
              {" · Other seasons: "}
              {others.map((s, i) => (
                <span key={s.slug}>
                  {i > 0 && ", "}
                  <Link
                    href={`/app/admin?season=${s.slug}`}
                    className="underline"
                  >
                    {s.name}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
        <nav aria-label="Admin tools">
          <ul className="flex flex-wrap gap-2">
            {[
              [base, "Season setup"],
              [`${base}/schedule`, "Schedule"],
              [`${base}/registrations`, "Registrations"],
              ["/app/admin/waivers", "Waivers"],
              ["/app/admin/events", "Events"],
              [`${base}/referees`, "Referees"],
              [`${base}/scores`, "Scores"],
              [`${base}/rainout`, "Rain-out"],
              ["/app/admin/seasons", "All seasons"],
              ["/app/admin/audit", "Audit log"],
            ].map(([href, label]) => (
              <li key={label}>
                <Link href={href as string} className="btn btn-secondary">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {isOwner && (
          <p>
            <a href="/app/admin/league.json" className="underline">
              Download all league data
            </a>{" "}
            <span className="text-text-muted">
              (seasons, teams, rosters, games, scores and payments, as JSON)
            </span>
          </p>
        )}
      </header>

      <NextGameDay day={day} base={base} dayLabel={dayLabel} time={time} />

      <section aria-labelledby="missing" className="flex flex-col gap-3">
        <h2 id="missing" className="text-h2">
          Missing scores{missing.length > 0 && ` (${missing.length})`}
        </h2>
        {missing.length === 0 ? (
          <p className="text-text-muted">
            Every game from past game days has a final score.
          </p>
        ) : (
          <>
            <p className="text-small text-text-muted">
              Games from past game days that still have no final score.
            </p>
            <ul className="flex flex-col">
              {missing.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between gap-4 border-t border-border py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-bold">{g.teams}</span>
                    <span className="text-small text-text-muted">
                      {when(g.startsAt)}
                    </span>
                    <span className="text-small">
                      <Status
                        tone={
                          g.state.state === "disputed" ? "danger" : "warning"
                        }
                      >
                        {SCORE_STATE[g.state.state] ?? g.state.state}
                      </Status>
                    </span>
                  </span>
                  <Link
                    href={`/app/games/${g.id}/score`}
                    className="inline-flex min-h-11 shrink-0 items-center underline"
                  >
                    {g.state.state === "awaiting" ? "See score" : "Set score"}
                    <span className="sr-only">: {g.teams}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href={`${base}/scores`} className="underline">
              All scores that need a look
            </Link>
          </>
        )}
      </section>

      {newTeams > 0 && (
        <p role="status" className="rounded-lg border border-warning p-3">
          <Link href={`${base}/new-teams`} className="underline">
            {newTeams === 1
              ? "1 new-team request is"
              : `${newTeams} new-team requests are`}{" "}
            waiting for an answer
          </Link>
        </p>
      )}

      <Registrations summary={registrations} href={`${base}/registrations`} />
    </>
  );
}

function NextGameDay({
  day,
  base,
  dayLabel,
  time,
}: {
  day: GameDay | null;
  base: string;
  dayLabel: (date: string) => string;
  time: (d: Date) => string;
}) {
  if (!day)
    return (
      <section aria-labelledby="next-day" className="flex flex-col gap-3">
        <h2 id="next-day" className="text-h2">
          Next game day
        </h2>
        <p>
          No games on the calendar. Publish a schedule and the next game day
          shows up here.
        </p>
        <p>
          <Link href={`${base}/schedule`} className="btn btn-primary">
            Open the schedule
          </Link>
        </p>
      </section>
    );

  const stats: [string, number, Tone][] = [
    ["Games", day.games.length, "muted"],
    ["Fields", day.fields, "muted"],
    [
      "Games with no ref",
      day.withoutReferee,
      day.withoutReferee ? "danger" : "success",
    ],
    [
      "Teams short on RSVPs",
      day.fieldingWarnings,
      day.fieldingWarnings ? "warning" : "success",
    ],
  ];
  return (
    <section aria-labelledby="next-day" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="next-day" className="text-h2">
          Next game day: {dayLabel(day.date)}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/referees`} className="btn btn-secondary">
            Assign refs
          </Link>
          <Link
            href={`${base}/rainout?date=${day.date}`}
            className="btn btn-secondary"
          >
            Call a rain-out
          </Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map(([label, value, tone]) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3"
          >
            <dt className="text-small text-text-muted">{label}</dt>
            <dd className="flex items-center gap-2 text-h3 font-bold tabular-nums">
              {tone !== "muted" && (
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full ${DOT[tone]}`}
                />
              )}
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="grid gap-3 md:grid-cols-2">
        {day.games.map((g) => (
          <GameCard key={g.id} game={g} time={time} />
        ))}
      </ul>
    </section>
  );
}

function GameCard({
  game,
  time,
}: {
  game: GameDayGame;
  time: (d: Date) => string;
}) {
  const [a, b] = game.teams;
  const called = game.rainedOut
    ? "Rained out, waiting for a makeup"
    : game.status === "final" || game.status === "forfeit"
      ? "Final"
      : game.status === "postponed"
        ? "Postponed"
        : game.status === "in_progress"
          ? "In progress"
          : null;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-small">
        <span className="font-bold">
          {time(game.startsAt)} · {game.fieldName}
        </span>
        {called ? (
          <Status tone="muted">{called}</Status>
        ) : game.referee ? (
          <Status tone="success">Ref: {game.referee.name}</Status>
        ) : (
          <Status tone="danger">No ref assigned</Status>
        )}
      </p>
      <h3 className="text-h3">
        {a.name} vs {b.name}
      </h3>
      {!called && (
        <ul className="flex flex-col gap-2 text-small">
          {[a, b].map((t) => (
            <TeamRsvpLine key={t.teamSeasonId} team={t} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TeamRsvpLine({ team }: { team: GameDayTeam }) {
  const { rsvps } = team;
  const fielding = FIELDING[rsvps.fielding.level];
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex flex-wrap justify-between gap-x-3">
        <span className="font-bold">{team.name}</span>
        <Status tone={fielding.tone}>{fielding.label}</Status>
      </span>
      <span className="text-text-muted">
        {rsvps.in} in · {rsvps.maybe} maybe · {rsvps.out} out · {rsvps.noAnswer}{" "}
        no reply
        {rsvps.fielding.level !== "full" &&
          `. Can field ${rsvps.fielding.fielders}.`}
      </span>
    </li>
  );
}

function Registrations({
  summary,
  href,
}: {
  summary: {
    teams: Awaited<ReturnType<typeof registrationSummary>>["teams"];
    freeAgents: GroupSummary;
    totals: GroupSummary;
  };
  href: string;
}) {
  const cells = (g: GroupSummary) => (
    <>
      {/* "N of M" already says how many; the column returns with room. */}
      <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">
        {g.players}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        <Count done={g.paid} of={g.players} />
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        <Count done={g.signed} of={g.players} />
      </td>
    </>
  );
  return (
    <section aria-labelledby="registrations" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="registrations" className="text-h2">
          Registrations
        </h2>
        <Link href={href} className="btn btn-secondary">
          Open registrations
        </Link>
      </div>
      {summary.teams.length === 0 && summary.freeAgents.players === 0 ? (
        <p className="text-text-muted">
          Nobody has registered yet. Teams show up here as captains sign up.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-small">
            <caption className="sr-only">
              Players, payments and waivers by team
            </caption>
            <thead>
              <tr className="border-b-2 border-border-strong text-left">
                <th scope="col" className="px-2 py-2">
                  Team
                </th>
                <th
                  scope="col"
                  className="hidden px-2 py-2 text-right sm:table-cell"
                >
                  Players
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  Paid
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  Waivers
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.teams.map((t) => (
                <tr key={t.teamSeasonId} className="border-b border-border">
                  <th scope="row" className="px-2 py-2 text-left font-normal">
                    <span className="block font-bold">{t.name}</span>
                    <span className="text-text-muted">
                      {TEAM_STATUS[t.status] ?? t.status}
                    </span>
                  </th>
                  {cells(t)}
                </tr>
              ))}
              <tr className="border-b border-border">
                <th scope="row" className="px-2 py-2 text-left font-bold">
                  Free agents
                </th>
                {cells(summary.freeAgents)}
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-strong font-bold">
                <th scope="row" className="px-2 py-2 text-left">
                  Total
                </th>
                {cells(summary.totals)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/** "3 of 11", or a dash when there is nobody to count. */
function Count({ done, of }: { done: number; of: number }) {
  if (of === 0) return <span className="text-text-muted">–</span>;
  return (
    <span className="whitespace-nowrap">
      {done}
      <span className="text-text-muted"> of {of}</span>
    </span>
  );
}
