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
import { nextTasks } from "@/db/queries/checklist";
import { ChecklistCard } from "@/components/checklist-card";
import { localDate } from "@/domain/books/ledger-csv";
import { seasonSignups } from "@/db/queries/challenges";
import { SignupBoard } from "@/components/signup-board";
import { needsReconnect } from "@/db/queries/social";
import type { FieldingLevel } from "@/domain/rsvp/fielding";
import { can } from "@/domain/authz/permissions";
import { requirePermission } from "@/lib/auth/permission";
import { PageLoading } from "@/components/page-loading";
import { activeLeague } from "@/lib/league/active";
import { ScrollTable } from "@/components/scroll-table";

export const metadata: Metadata = { title: "League admin" };

export default function AdminHomePage(props: PageProps<"/[lang]/app/admin">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
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

async function Dashboard({ searchParams }: PageProps<"/[lang]/app/admin">) {
  const subject = await requirePermission("season.manage", {
    next: "/app/admin",
  });
  const isOwner = subject.globalRole === "owner";
  const query = await searchParams;
  const now = new Date();
  const league = await activeLeague();
  if (!league) notFound();
  const current = await dashboardSeason(
    db,
    league.id,
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

  const [
    day,
    missing,
    registrations,
    others,
    newTeams,
    instagram,
    signups,
    checklist,
  ] = await Promise.all([
    nextGameDay(db, current, now),
    missingScores(db, current, now),
    registrationSummary(db, current.id),
    otherSeasons(db, league.id, current.id),
    pendingNewTeamCount(db, current.id),
    needsReconnect(db, league.id),
    seasonSignups(db, current.id),
    nextTasks(db, current.id),
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

  const today = localDate(now, current.timeZone);
  const isGameDay = day?.date === today;
  // A few "needs you" items lead the page; each opens where it's settled.
  const needs: { key: string; href: string; label: string }[] = [];
  if (missing.length > 0)
    needs.push({
      key: "scores",
      href: "#missing",
      label:
        missing.length === 1
          ? "1 game needs a final score"
          : `${missing.length} games need a final score`,
    });
  if (newTeams > 0)
    needs.push({
      key: "new-teams",
      href: `${base}/new-teams`,
      label:
        newTeams === 1
          ? "1 new-team request is waiting for an answer"
          : `${newTeams} new-team requests are waiting for an answer`,
    });
  if (instagram)
    needs.push({
      key: "instagram",
      href: "/app/admin/instagram",
      label: `Reconnect Instagram: posts from @${instagram.username} stopped syncing`,
    });

  return (
    <>
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
            League admin
          </p>
          <h1 className="text-h1">{current.name}</h1>
          <SeasonSwitcher
            status={SEASON_STATUS[current.status] ?? current.status}
            others={others}
          />
        </div>
        <AdminTools
          slug={current.slug}
          primary={primaryActions(base, current.status, isGameDay)}
          isOwner={isOwner}
          books={can(subject, "books.manage")}
          dashboard={
            can(subject, "books.manage") && can(subject, "dashboard.view")
          }
        />
      </header>

      {needs.length > 0 && (
        <section aria-labelledby="needs-you" className="flex flex-col gap-2">
          <h2 id="needs-you" className="text-h3">
            Needs you
          </h2>
          <ul className="flex flex-col rounded-card border-2 border-warning bg-surface px-4">
            {needs.map((n) => (
              <li
                key={n.key}
                className="border-b border-border last:border-b-0"
              >
                <Link
                  href={n.href}
                  className="flex min-h-12 items-center justify-between gap-3 py-2 font-bold hover:underline"
                >
                  {n.label}
                  <span aria-hidden="true" className="text-text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NextGameDay
        day={day}
        today={isGameDay}
        base={base}
        dayLabel={dayLabel}
        time={time}
      />

      <ChecklistCard
        tasks={checklist}
        today={today}
        href={`${base}/checklist`}
      />

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
              Games from past game days that still have no final score, and any
              score a captain disputed.
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

      <Registrations summary={registrations} href={`${base}/registrations`} />
      {/* Sign-ups matter while players can still join; mid-season the
          registrations table above already says it. */}
      {current.status === "registration_open" && signups.length > 0 && (
        <section aria-labelledby="signups" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="signups" className="text-h2">
              Sign-up rate
            </h2>
            <Link href={`${base}/challenge`} className="btn btn-secondary">
              Sign-up challenge
            </Link>
          </div>
          <p className="text-text-muted">
            Players with an account and a signed waiver, out of each team&apos;s
            expected roster. Lowest first: these teams need a nudge.
          </p>
          <SignupBoard
            rows={[...signups].sort(
              (a, b) =>
                a.progress.percent - b.progress.percent ||
                a.name.localeCompare(b.name),
            )}
            caption="Sign-up rate by team, lowest first"
            nudge
          />
        </section>
      )}
    </>
  );
}

function NextGameDay({
  day,
  today,
  base,
  dayLabel,
  time,
}: {
  day: GameDay | null;
  /** The next game day is today. */
  today: boolean;
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
          {today ? "Game day today" : "Next game day"}: {dayLabel(day.date)}
        </h2>
        <p className="flex flex-wrap gap-x-4">
          {day.withoutReferee > 0 && (
            <Link
              href={`${base}/referees`}
              className="inline-flex min-h-11 items-center font-bold underline"
            >
              Assign refs
            </Link>
          )}
          <Link
            href={`${base}/rainout?date=${day.date}`}
            className="inline-flex min-h-11 items-center font-bold underline"
          >
            Call a rain-out
          </Link>
        </p>
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
        <ScrollTable label="Registrations by team">
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
        </ScrollTable>
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

type Tool = readonly [href: string, label: string];
type ToolGroup = { title: string; tools: Tool[] };

/**
 * The one or two tools an admin most likely wants right now: the game-day
 * screen and scores on a game day, registrations while sign-ups run, and
 * otherwise the schedule. Everything else waits in "League tools".
 */
function primaryActions(
  base: string,
  status: string,
  isGameDay: boolean,
): Tool[] {
  if (isGameDay)
    return [
      ["/app/admin/today", "Game day screen"],
      [`${base}/scores`, "Scores"],
    ];
  if (
    status === "draft" ||
    status === "registration_open" ||
    status === "registration_closed"
  )
    return [
      [`${base}/registrations`, "Registrations"],
      [`${base}/schedule`, "Schedule"],
    ];
  return [[`${base}/schedule`, "Schedule"]];
}

/**
 * The season on show and a compact way to the others: a native <details>
 * that opens a short list, so it needs no script.
 */
function SeasonSwitcher({
  status,
  others,
}: {
  status: string;
  others: readonly { slug: string; name: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-text-muted">
      <span>{status}</span>
      {others.length > 0 && (
        <details className="group relative">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 underline [&::-webkit-details-marker]:hidden">
            Other seasons
            <span
              aria-hidden="true"
              className="transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <ul className="absolute top-full left-0 z-20 flex min-w-56 flex-col rounded-card border-2 border-text bg-surface px-4 py-1 text-text shadow-sticker">
            {others.map((s) => (
              <li
                key={s.slug}
                className="border-b border-border last:border-b-0"
              >
                <Link
                  href={`/app/admin?season=${s.slug}`}
                  className="flex min-h-11 items-center hover:underline"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The admin's tools: one or two for the moment in sight, and every tool in
 * one "League tools" disclosure, grouped by job like the app menu. Each
 * person sees only the tools they may open.
 */
function AdminTools({
  slug,
  primary,
  isOwner,
  books,
  dashboard,
}: {
  slug: string;
  primary: Tool[];
  isOwner: boolean;
  /** Keeps the books and the permits (owners). */
  books: boolean;
  /** Opens the owner dashboard. */
  dashboard: boolean;
}) {
  const base = `/app/admin/seasons/${slug}`;
  const only = (on: boolean, tools: Tool[]): Tool[] => (on ? tools : []);
  const groups: ToolGroup[] = [
    {
      title: "Game day",
      tools: [
        ["/app/admin/today", "Game day screen"],
        [`${base}/scores`, "Scores"],
        [`${base}/referees`, "Referees"],
        ["/app/admin/today/print", "Print game-day pack"],
        ["/app/admin/equipment", "League gear"],
        [`${base}/team-of-the-week`, "Team of the week"],
      ],
    },
    {
      title: "Season",
      tools: [
        [base, "Season setup"],
        [`${base}/schedule`, "Schedule"],
        [`${base}/registrations`, "Registrations"],
        [`${base}/rainout`, "Rain-out"],
        [`${base}/checklist`, "Season checklist"],
        [`${base}/survey`, "Season survey"],
        ["/app/admin/interest", "Interest sign-ups"],
        ["/app/admin/seasons", "All seasons"],
      ],
    },
    {
      title: "Fields",
      tools: [
        [`${base}/fields`, "Fields and permit windows"],
        ...only(books, [[`/app/books/${slug}/permits`, "Permits"]]),
      ],
    },
    {
      title: "Money and merch",
      tools: [
        ...only(dashboard, [[`/app/owner/${slug}`, "Owner dashboard"]]),
        ...only(books, [[`/app/books/${slug}`, "Books"]]),
        ["/app/sponsor", "Sponsors"],
        [`${base}/rebates`, "Rebates"],
        ["/app/admin/credit", "League credit"],
        ["/app/admin/merch", "Merch"],
        ["/app/admin/shirt-waiting", "Late-joiner shirts"],
        ["/app/admin/shirt-makers", "Shirt makers"],
      ],
    },
    {
      title: "Players and safety",
      tools: [
        ["/app/admin/waivers", "Waivers"],
        ["/app/admin/conduct", "Code of conduct"],
        ["/app/admin/incidents", "Incidents"],
        ["/app/admin/team-lists", "Not-on-my-team lists"],
        ["/app/admin/team-changes", "Looking for a change"],
        ["/app/admin/accounts", "Merge accounts"],
      ],
    },
    {
      title: "League life",
      tools: [
        ["/app/admin/events", "Events"],
        ["/app/admin/volunteer", "Volunteer shifts"],
        ["/app/admin/rules", "League rules"],
        ["/app/admin/pickem", "Pick'em"],
        ["/app/admin/private-events", "Private leagues and tournaments"],
        ["/app/admin/friends", "Friends of the league"],
        ["/app/admin/photos", "Member photos"],
        ["/app/admin/instagram", "Instagram"],
      ],
    },
    {
      title: "Records and access",
      tools: [
        ...only(isOwner, [["/app/admin/acting-admins", "Acting admins"]]),
        ["/app/admin/alerts", "Alert choices"],
        ["/app/admin/audit", "Audit log"],
      ],
    },
  ];
  return (
    <nav aria-label="Admin tools" className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {primary.map(([href, label], i) => (
          <li key={href}>
            <Link
              href={href}
              className={`btn ${i === 0 ? "btn-primary" : "btn-secondary"}`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <details className="group rounded-card border-2 border-text bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 font-bold [&::-webkit-details-marker]:hidden">
          League tools
          <span
            aria-hidden="true"
            className="text-text-muted transition-transform group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="grid gap-x-8 gap-y-5 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <section
              key={group.title}
              aria-labelledby={`tools-${slugify(group.title)}`}
              className="flex flex-col"
            >
              <h2
                id={`tools-${slugify(group.title)}`}
                className="text-micro font-bold tracking-widest text-text-muted uppercase"
              >
                {group.title}
              </h2>
              <ul className="flex flex-col">
                {group.tools.map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      prefetch={false}
                      className="flex min-h-11 items-center border-b border-border hover:underline"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {isOwner && (
            <p className="text-small sm:col-span-2 lg:col-span-3">
              <a
                href="/app/admin/league.json"
                className="inline-flex min-h-11 items-center font-bold underline"
              >
                Download all league data
              </a>{" "}
              <span className="text-text-muted">
                (seasons, teams, rosters, games, scores, payments and the books,
                as JSON)
              </span>
            </p>
          )}
        </div>
      </details>
    </nav>
  );
}

const slugify = (title: string) => title.toLowerCase().replace(/[^a-z]+/g, "-");
