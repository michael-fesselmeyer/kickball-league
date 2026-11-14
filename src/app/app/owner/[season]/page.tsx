import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { money } from "@/domain/books/ledger";
import { percent } from "@/domain/dashboard/metrics";
import { spentCategories } from "@/domain/dashboard/view";
import { requirePermission } from "@/lib/auth/permission";
import { SeasonPicker } from "../../books/season-picker";
import { refreshDashboardAction } from "../actions";
import {
  Legend,
  Meter,
  PairBars,
  SERIES_1,
  SERIES_2,
  StackBar,
  WeekColumns,
} from "../charts";
import { cachedDashboard, ownerSeason } from "../load";

export const metadata: Metadata = { title: "Owner dashboard" };

export default function OwnerDashboardPage(
  props: PageProps<"/app/owner/[season]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the dashboard…</PageLoading>}>
        <Dashboard {...props} />
      </Suspense>
    </main>
  );
}

const NOTICES: Record<string, string> = {
  refreshed: "Numbers refreshed.",
};

const th = "py-2 pr-3 text-left font-normal";
const num = "py-2 pl-3 text-right tabular-nums";
/** A numeric column's header. */
const numHead = `${num} font-normal`;

const time = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(d);

const weekLabel = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

async function Dashboard({
  params,
  searchParams,
}: PageProps<"/app/owner/[season]">) {
  const { season: slug } = await params;
  const page = `/app/owner/${slug}`;
  await requirePermission("dashboard.view", { next: page });
  const query = await searchParams;
  const { league, season, seasons } = await ownerSeason(slug);
  const { view, readAt, publishedAt } = await cachedDashboard(
    league.id,
    season,
  );
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const { selected } = view;
  const members = selected.membership;
  const moneyHere = selected.money;
  const maxMembers = Math.max(0, ...view.membership.map((m) => m.members));
  const maxMoney = Math.max(
    0,
    ...view.money.flatMap((m) => [m.incomeCents, m.expenseTotalCents]),
  );
  const categories = spentCategories(view.money);

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Owner dashboard</h1>
        <p className="text-text-muted">
          How the league is doing, season by season. Owners only; admins
          don&apos;t see this page.
        </p>
        {notice && (
          <p role="status" className="rounded-lg border border-success p-3">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SeasonPicker
            seasons={seasons}
            current={season.slug}
            path={(s) => `/app/owner/${s}`}
          />
          <a href={`${page}/dashboard.csv`} className="btn btn-secondary">
            Download CSV
          </a>
          <Link href={`${page}/summary`} className="btn btn-secondary">
            Money summary
          </Link>
        </div>
        <form
          action={refreshDashboardAction.bind(null, season.slug)}
          className="flex flex-wrap items-center gap-3 text-small text-text-muted"
        >
          <span>Numbers as of {time(readAt, league.timeZone)}.</span>
          <button type="submit" className="underline">
            Refresh now
          </button>
        </form>
      </header>

      <section aria-labelledby="membership" className="flex flex-col gap-3">
        <h2 id="membership" className="text-h2">
          Membership
        </h2>
        {members && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Members" value={String(members.members)} />
            <Stat label="New" value={String(members.newMembers)} />
            <Stat label="Returning" value={String(members.returning)} />
            <Stat
              label="Back from the season before"
              value={percent(members.retention)}
            />
          </dl>
        )}
        <Legend
          series={[
            { key: "returning", label: "Returning", className: SERIES_1 },
            { key: "new", label: "New", className: SERIES_2 },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">
              Members by season: new, returning, and how many of the season
              before came back
            </caption>
            <thead className="text-small text-text-muted">
              <tr>
                <th scope="col" className={th}>
                  Season
                </th>
                <th scope="col" className={numHead}>
                  New
                </th>
                <th scope="col" className={numHead}>
                  Returning
                </th>
                <th scope="col" className={numHead}>
                  Retention
                </th>
              </tr>
            </thead>
            <tbody>
              {view.membership.map((m) => (
                <tr key={m.seasonId} className="border-t border-border">
                  <th scope="row" className={`${th} w-1/2`}>
                    <span className="flex flex-col gap-1">
                      <span>
                        {m.name}{" "}
                        <span className="text-text-muted">
                          · {m.members} {m.members === 1 ? "member" : "members"}
                        </span>
                      </span>
                      <StackBar
                        max={maxMembers}
                        segments={[
                          {
                            label: "Returning",
                            value: m.returning,
                            className: SERIES_1,
                          },
                          {
                            label: "New",
                            value: m.newMembers,
                            className: SERIES_2,
                          },
                        ]}
                      />
                    </span>
                  </th>
                  <td className={num}>{m.newMembers}</td>
                  <td className={num}>{m.returning}</td>
                  <td className={num}>{percent(m.retention)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-small text-text-muted">
          Retention is the share of the season before&apos;s members who signed
          up again. Members have a registration that isn&apos;t cancelled,
          waitlisted or refunded.
        </p>
      </section>

      <section aria-labelledby="money" className="flex flex-col gap-3">
        <h2 id="money" className="text-h2">
          Money in and out
        </h2>
        {moneyHere && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Money in" value={money(moneyHere.incomeCents)} />
            <Stat
              label="Money out"
              value={money(moneyHere.expenseTotalCents)}
            />
            <Stat label="Net" value={money(moneyHere.netCents)} />
          </dl>
        )}
        <Legend
          series={[
            { key: "in", label: "Money in", className: SERIES_1 },
            { key: "out", label: "Money out", className: SERIES_2 },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Money in and out by season</caption>
            <thead className="text-small text-text-muted">
              <tr>
                <th scope="col" className={th}>
                  Season
                </th>
                <th scope="col" className={numHead}>
                  In
                </th>
                <th scope="col" className={numHead}>
                  Out
                </th>
                <th scope="col" className={`${numHead} hidden sm:table-cell`}>
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {view.money.map((m) => (
                <tr key={m.seasonId} className="border-t border-border">
                  <th scope="row" className={`${th} w-1/2`}>
                    <span className="flex flex-col gap-1">
                      {m.name}
                      <PairBars
                        max={maxMoney}
                        bars={[
                          {
                            label: `Money in: ${money(m.incomeCents)}`,
                            value: m.incomeCents,
                            className: SERIES_1,
                          },
                          {
                            label: `Money out: ${money(m.expenseTotalCents)}`,
                            value: m.expenseTotalCents,
                            className: SERIES_2,
                          },
                        ]}
                      />
                    </span>
                  </th>
                  <td className={num}>{money(m.incomeCents)}</td>
                  <td className={num}>{money(m.expenseTotalCents)}</td>
                  <td className={`${num} hidden sm:table-cell`}>
                    {money(m.netCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {moneyHere && (
          <div className="grid gap-6 sm:grid-cols-2">
            <table className="w-full">
              <caption className="pb-1 text-left text-h3">
                {season.name}: money in
              </caption>
              <tbody>
                {(
                  [
                    ["Registrations in the app", moneyHere.registrationsCents],
                    ["Event tickets in the app", moneyHere.ticketsCents],
                    ["Merch in the app", moneyHere.merchCents],
                    ["Paid outside the app", moneyHere.offAppCents],
                    ["Refunds", -moneyHere.refundsCents],
                  ] as const
                ).map(([label, cents]) => (
                  <tr key={label} className="border-t border-border">
                    <th scope="row" className={th}>
                      {label}
                    </th>
                    <td className={num}>{money(cents)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-text font-bold">
                  <th scope="row" className={`${th} font-bold`}>
                    Total
                  </th>
                  <td className={num}>{money(moneyHere.incomeCents)}</td>
                </tr>
              </tbody>
            </table>
            <table className="w-full">
              <caption className="pb-1 text-left text-h3">
                {season.name}: money out
              </caption>
              <tbody>
                {moneyHere.expenses
                  .filter((e) => e.cents > 0 || categories.includes(e.category))
                  .map((e) => (
                    <tr key={e.category} className="border-t border-border">
                      <th scope="row" className={th}>
                        {e.label}
                      </th>
                      <td className={num}>{money(e.cents)}</td>
                    </tr>
                  ))}
                <tr className="border-t-2 border-text font-bold">
                  <th scope="row" className={`${th} font-bold`}>
                    Total
                  </th>
                  <td className={num}>{money(moneyHere.expenseTotalCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-small text-text-muted">
          From what the app records, as{" "}
          <Link href={`/app/books/${season.slug}`} className="underline">
            the books
          </Link>{" "}
          count it. League credit spent at checkout (
          {money(moneyHere?.creditCents ?? 0)} this season) isn&apos;t money in:
          the league gave that credit earlier.
        </p>
      </section>

      <section aria-labelledby="teams" className="flex flex-col gap-3">
        <h2 id="teams" className="text-h2">
          Teams: sign-ups, waivers and payments
        </h2>
        {members && (
          <dl className="grid grid-cols-2 gap-3">
            <Stat
              label="Waivers signed"
              value={`${members.signed} of ${members.members}`}
            />
            <Stat
              label="Paid up"
              value={`${members.paid} of ${members.members}`}
            />
          </dl>
        )}
        {selected.teams.length === 0 ? (
          <p className="text-text-muted">Nobody has signed up yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">
                {season.name} teams: roster against its target, waivers signed
                and payments made
              </caption>
              <thead className="text-small text-text-muted">
                <tr>
                  <th scope="col" className={th}>
                    Team
                  </th>
                  <th scope="col" className={numHead}>
                    Roster
                  </th>
                  <th scope="col" className={numHead}>
                    Waivers
                  </th>
                  <th scope="col" className={numHead}>
                    Paid
                  </th>
                </tr>
              </thead>
              <tbody>
                {selected.teams.map((t) => (
                  <tr
                    key={t.teamSeasonId ?? "none"}
                    className="border-t border-border"
                  >
                    <th scope="row" className={th}>
                      {t.name}
                    </th>
                    <td className={num}>
                      <Rate
                        rate={t.signUpRate}
                        text={
                          t.target
                            ? `${t.members}/${t.target}`
                            : String(t.members)
                        }
                      />
                    </td>
                    <td className={num}>
                      <Rate rate={t.waiverRate} text={percent(t.waiverRate)} />
                    </td>
                    <td className={num}>
                      <Rate
                        rate={t.paymentRate}
                        text={percent(t.paymentRate)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-small text-text-muted">
          Roster is members against the team&apos;s target size (the
          season&apos;s largest roster when it set none).
        </p>
      </section>

      <section aria-labelledby="events" className="flex flex-col gap-3">
        <h2 id="events" className="text-h2">
          Event turnout
        </h2>
        {selected.events.length === 0 ? (
          <p className="text-text-muted">No events during this season.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">
                Events during {season.name}: people going and checked in
              </caption>
              <thead className="text-small text-text-muted">
                <tr>
                  <th scope="col" className={th}>
                    Event
                  </th>
                  <th scope="col" className={numHead}>
                    Going
                  </th>
                  <th scope="col" className={numHead}>
                    Checked in
                  </th>
                </tr>
              </thead>
              <tbody>
                {selected.events.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <th scope="row" className={th}>
                      {e.title}{" "}
                      <span className="text-small text-text-muted">
                        {weekLabel(e.startsAt.toISOString().slice(0, 10))}
                      </span>
                    </th>
                    <td className={num}>{e.signedUp}</td>
                    <td className={num}>
                      {e.checkedIn === null ? (
                        <span className="text-text-muted">No tickets</span>
                      ) : (
                        <Rate
                          rate={e.turnout}
                          text={`${e.checkedIn} (${percent(e.turnout)})`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-small text-text-muted">
          Check-ins are tickets scanned at the door, so only ticketed events
          have them.
        </p>
      </section>

      <section aria-labelledby="checkins" className="flex flex-col gap-3">
        <h2 id="checkins" className="text-h2">
          Sponsor check-ins by week
        </h2>
        {selected.checkins.every((w) => w.checkins === 0) ? (
          <p className="text-text-muted">
            No check-ins at sponsor bars this season.
          </p>
        ) : (
          <>
            <WeekColumns
              id="checkins-chart"
              title={`Check-ins at sponsor bars each week of ${season.name}`}
              weeks={selected.checkins.map((w) => ({
                label: weekLabel(w.weekOf),
                value: w.checkins,
              }))}
            />
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
                Check-ins as a table
              </summary>
              <table className="w-full">
                <caption className="sr-only">
                  Check-ins at sponsor bars by week, with the busiest bar
                </caption>
                <thead className="text-small text-text-muted">
                  <tr>
                    <th scope="col" className={th}>
                      Week of
                    </th>
                    <th scope="col" className={numHead}>
                      Check-ins
                    </th>
                    <th scope="col" className={`${th} pl-3`}>
                      Busiest bar
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.checkins.map((w) => (
                    <tr key={w.weekOf} className="border-t border-border">
                      <th scope="row" className={th}>
                        {weekLabel(w.weekOf)}
                      </th>
                      <td className={num}>{w.checkins}</td>
                      <td className={`${th} pl-3`}>
                        {w.bySponsor[0]?.sponsor ?? "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>

      <p className="text-small text-text-muted">
        {publishedAt ? (
          <>
            The {season.name} money summary is public.{" "}
            <Link href={`/seasons/${season.slug}/money`} className="underline">
              See it
            </Link>
          </>
        ) : (
          <>The {season.name} money summary isn&apos;t published.</>
        )}{" "}
        <Link href={`${page}/summary`} className="underline">
          Preview or change it
        </Link>
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-3">
      <dt className="text-small text-text-muted">{label}</dt>
      <dd className="font-display text-h3 tabular-nums">{value}</dd>
    </div>
  );
}

function Rate({ rate, text }: { rate: number | null; text: string }) {
  return (
    <span className="ml-auto flex w-14 flex-col items-end gap-1">
      {text}
      <Meter value={rate} />
    </span>
  );
}
