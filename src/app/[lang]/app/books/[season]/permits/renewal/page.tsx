import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { renewalInputs } from "@/db/queries/permit-packet";
import { localDate } from "@/domain/books/ledger-csv";
import { daysUntil } from "@/domain/books/reminders";
import { PERIOD_LABELS } from "@/domain/permits/calendar";
import {
  heldWindows,
  patternsOf,
  type RenewalWarning,
  renewalTarget,
  type Row,
  splitRenewal,
  WEEKLY_RENEWAL_CAP,
} from "@/domain/permits/renewal";
import { PageLoading } from "@/components/page-loading";
import { requirePermission } from "@/lib/auth/permission";
import { CopySheet } from "../../../copy-sheet";
import { booksSeason } from "../../../load";
import { sheetText, WEEKDAYS } from "../request";
import { wantedFrom } from "./choices";

export const metadata: Metadata = { title: "Permit renewal" };

export default function RenewalPage(
  props: PageProps<"/app/books/[season]/permits/renewal">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Renewal {...props} />
      </Suspense>
    </main>
  );
}

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

const day = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

const plural = (weekday: number) => `${WEEKDAYS[weekday]}s`;

function warningText(w: RenewalWarning): string {
  switch (w.kind) {
    case "more_time":
      return `${w.place}, ${plural(w.weekday)}: ${w.extra.join(" and ")} is more than last year's hours. Asking for it in the renewal would make the whole request new and cost the league its returning status, so it's split off below as a separate new request.`;
    case "changed_hours":
      return `${w.place}, ${plural(w.weekday)}: different hours from last year's ${w.held} would make it a new request. The renewal keeps ${w.held}; give back what the league won't use instead.`;
    case "dropped":
      return `${w.place}, ${plural(w.weekday)} ${w.held} is left out. Renewing less is allowed, but the league can't renew this time again next year.`;
    case "new_field":
      return `${w.place} on ${plural(w.weekday)} wasn't held last year, so it can only be asked for as a new request, in the new-request period.`;
    case "outside_period":
      return `${w.place}, ${plural(w.weekday)}: ${w.dates} of last season's ${w.dates === 1 ? "date falls" : "dates fall"} outside NYC Parks' next period, so ${w.dates === 1 ? "it isn't" : "they aren't"} in the renewal. Ask for ${w.dates === 1 ? "it" : "them"} with the next period's own application.`;
    case "weekly_cap":
      return `The renewal is ${w.hours} hours a week. One holder can renew at most ${WEEKLY_RENEWAL_CAP}; Parks may grant part of it.`;
  }
}

function Sheet({
  rows,
  label,
  copy,
}: {
  rows: readonly Row[];
  label: string;
  copy: string;
}) {
  return (
    <>
      <CopySheet
        text={sheetText(rows.map((r) => ({ ...r, field: r.place })))}
        label={copy}
      />
      <div
        role="region"
        aria-label={label}
        // A scrolling region must be reachable by keyboard, even with no links.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="overflow-x-auto"
      >
        <table className="w-full text-left">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b-2 border-border-strong">
              <th scope="col" className="py-2 pr-3">
                Date
              </th>
              <th scope="col" className="py-2 pr-3">
                Field
              </th>
              <th scope="col" className="py-2">
                Hours
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.date}/${r.place}/${r.start}`}
                className="border-b border-border"
              >
                <td className="py-2 pr-3 whitespace-nowrap">{day(r.date)}</td>
                <td className="py-2 pr-3">{r.place}</td>
                <td className="py-2 whitespace-nowrap">
                  {r.start}–{r.end}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Renewal({
  params,
  searchParams,
}: PageProps<"/app/books/[season]/permits/renewal">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}/permits/renewal`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season } = await booksSeason(slug);
  const { windows, fields } = await renewalInputs(db, league.id, season.id);
  const patterns = patternsOf(heldWindows(windows), league.timeZone);
  const target = renewalTarget(patterns);
  const { wanted, changed, added } = wantedFrom(query, patterns, fields);
  const plan = target ? splitRenewal(patterns, wanted, target) : null;
  const today = localDate(new Date(), league.timeZone);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/books/${slug}/permits`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Permits: {season.name}
        </Link>
        <h1 className="text-h1">Renew for next year</h1>
        <p className="text-text-muted">
          NYC Parks gives a returning league first claim on the same fields and
          hours it held last year, if it asks during the renewal period. This
          drafts that request from {season.name}&apos;s permits. Anything more
          goes in a separate new request, so the renewal stays a renewal.
        </p>
      </header>

      {!plan || !target ? (
        <p className="rounded-lg border border-border p-3">
          {season.name} has no permits to renew. Add its permit windows on the
          fields screen first.
        </p>
      ) : (
        <>
          <section aria-labelledby="when" className="flex flex-col gap-2">
            <h2 id="when" className="text-h2">
              When to ask
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-text-muted">Renewals</dt>
              <dd>
                {day(target.renewals.from)} to {day(target.renewals.to)}
                {daysUntil(today, target.renewals.from) > 0 && (
                  <strong className="ml-2">
                    opens in {daysUntil(today, target.renewals.from)} days
                  </strong>
                )}
                {today > target.renewals.to && (
                  <strong className="ml-2 text-danger">closed</strong>
                )}
              </dd>
              <dt className="text-text-muted">New requests</dt>
              <dd>
                {day(target.newRequests.from)} to {day(target.newRequests.to)}
              </dd>
              <dt className="text-text-muted">Playing</dt>
              <dd>
                {PERIOD_LABELS[target.period]}, {day(target.plays.from)} to{" "}
                {day(target.plays.to)}
              </dd>
            </dl>
            <p className="text-small text-text-muted">
              Owners get an email 30 and 7 days before renewals open.
            </p>
          </section>

          {plan.warnings.length > 0 && (
            <section
              aria-labelledby="warnings"
              className="flex flex-col gap-2 rounded-lg border-2 border-warning p-4"
            >
              <h2 id="warnings" className="text-h2">
                Before you renew
              </h2>
              <ul className="flex list-disc flex-col gap-2 pl-5">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{warningText(w)}</li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="changes" className="flex flex-col gap-3">
            <h2 id="changes" className="text-h2">
              What the league wants next year
            </h2>
            <form method="get" action={page} className="flex flex-col gap-4">
              <input type="hidden" name="set" value="1" />
              {patterns.map((p, i) => {
                const mine = wanted.find((w) => w.of === p.key);
                const label = `${p.place}, ${plural(p.weekday)}`;
                return (
                  <fieldset
                    key={p.key}
                    className="flex flex-col gap-2 border-t border-border pt-3"
                  >
                    <legend className="font-semibold">{label}</legend>
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        name={`k${i}`}
                        defaultChecked={!changed || mine !== undefined}
                        className="size-5"
                      />
                      Keep it (held {p.start}–{p.end}, {p.dates.length}{" "}
                      {p.dates.length === 1 ? "date" : "dates"})
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-small">From</span>
                        <input
                          type="time"
                          name={`s${i}`}
                          defaultValue={mine?.start ?? p.start}
                          className={input}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-small">To</span>
                        <input
                          type="time"
                          name={`e${i}`}
                          defaultValue={mine?.end ?? p.end}
                          className={input}
                        />
                      </label>
                    </div>
                  </fieldset>
                );
              })}
              <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
                <legend className="font-semibold">
                  Add a field or a day (optional)
                </legend>
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-small">Field</span>
                    <select
                      name="af"
                      defaultValue={added?.fieldId ?? ""}
                      className={input}
                    >
                      <option value="">None</option>
                      {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.place}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-small">Day</span>
                    <select
                      name="aw"
                      defaultValue={added?.weekday ?? patterns[0]?.weekday}
                      className={input}
                    >
                      {WEEKDAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-small">From</span>
                    <input
                      type="time"
                      name="as"
                      defaultValue={added?.start ?? ""}
                      className={input}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-small">To</span>
                    <input
                      type="time"
                      name="ae"
                      defaultValue={added?.end ?? ""}
                      className={input}
                    />
                  </label>
                </div>
              </fieldset>
              <button type="submit" className="btn self-start btn-secondary">
                Check the changes
              </button>
            </form>
          </section>

          <section aria-labelledby="renewal" className="flex flex-col gap-3">
            <h2 id="renewal" className="text-h2">
              The renewal
            </h2>
            {plan.renewal.length === 0 ? (
              <p className="text-text-muted">Nothing is left to renew.</p>
            ) : (
              <>
                <p>
                  {plan.renewal.length} bookings and{" "}
                  {plan.renewalHours.toLocaleString("en-US")} field hours: the
                  same fields, days and hours as {season.name}, a year on.
                </p>
                <Sheet
                  rows={plan.renewal}
                  label="Bookings to renew"
                  copy="Copy the renewal"
                />
              </>
            )}
          </section>

          {plan.extra.length > 0 && (
            <section aria-labelledby="extra" className="flex flex-col gap-3">
              <h2 id="extra" className="text-h2">
                A separate new request
              </h2>
              <p>
                {plan.extra.length} bookings and{" "}
                {plan.extraHours.toLocaleString("en-US")} field hours. File them
                as their own request in the new-request period,{" "}
                {day(target.newRequests.from)} to {day(target.newRequests.to)},
                so the renewal keeps the league&apos;s returning status.
              </p>
              <Sheet
                rows={plan.extra}
                label="Bookings for a new request"
                copy="Copy the new request"
              />
            </section>
          )}

          <Link
            href={`/app/books/${slug}/permits/packet`}
            className="btn self-start btn-secondary"
          >
            The application packet
          </Link>
        </>
      )}
    </>
  );
}
