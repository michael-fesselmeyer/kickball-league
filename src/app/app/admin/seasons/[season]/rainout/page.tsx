import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { loadVersion } from "@/db/queries/schedule";
import {
  scheduleLabels,
  seasonBySlug,
  versionsOf,
} from "@/db/queries/schedule-screen";
import { measure } from "@/domain/scheduler/measure";
import { reschedule } from "@/domain/scheduler/reschedule";
import { requirePermission } from "@/lib/auth/permission";
import { declareRainout } from "./actions";

export const metadata: Metadata = { title: "Rain-out" };

export default function RainoutPage(
  props: PageProps<"/app/admin/seasons/[season]/rainout">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Rainout {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  no_published: "Publish a schedule before calling a rain-out.",
  no_games: "There are no slots on that date.",
};

async function Rainout({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/rainout">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/rainout`;
  await requirePermission("rainout.declare", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();

  const published = (await versionsOf(db, season.id)).find(
    (v) => v.status === "published",
  );
  const version = published ? await loadVersion(db, published.id) : null;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const header = (
    <header className="flex flex-col gap-1">
      <p className="text-text-muted">{season.name}</p>
      <h1 className="text-h1">Call a rain-out</h1>
      <Link href={`/app/admin/seasons/${slug}/schedule`} className="underline">
        Back to the schedule
      </Link>
    </header>
  );
  if (!version)
    return (
      <>
        {header}
        <p>{ERRORS.no_published}</p>
      </>
    );

  const labels = await scheduleLabels(db, season.id, season.timeZone);
  const slotDate = new Map(version.input.slots.map((s) => [s.id, s.date]));
  const dates = [
    ...new Set(
      version.schedule.games.flatMap((g) =>
        g.slotId ? [slotDate.get(g.slotId)] : [],
      ),
    ),
  ]
    .filter((d): d is string => d !== undefined)
    .sort();
  const date =
    typeof query.date === "string" && dates.includes(query.date)
      ? query.date
      : null;
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${d}T12:00:00Z`));
  const team = (id: string) => labels.teams.get(id) ?? id;
  const where = (slotId: string | null) => {
    const s = slotId ? labels.slots.get(slotId) : undefined;
    return s ? `${s.day}, ${s.time}, ${s.field}` : "No slot";
  };

  let preview = null;
  if (date) {
    const cancelled = version.input.slots
      .filter((s) => s.date === date)
      .map((s) => s.id);
    const result = reschedule(version.input, version.schedule, cancelled);
    const before = measure(version.input, version.schedule);
    const games = new Map(version.schedule.games.map((g) => [g.key, g]));
    preview = (
      <section aria-labelledby="preview" className="flex flex-col gap-4">
        <h2 id="preview" className="text-h2">
          If {dayLabel(date)} is rained out
        </h2>
        <table className="w-full text-left">
          <thead className="text-text-muted">
            <tr>
              <th scope="col">Game</th>
              <th scope="col">Was</th>
              <th scope="col">Makeup</th>
            </tr>
          </thead>
          <tbody>
            {result.moved.map((m) => {
              const g = games.get(m.gameKey);
              return (
                <tr key={m.gameKey} className="border-t border-border">
                  <td>
                    {g ? `${team(g.teamA)} vs ${team(g.teamB)}` : m.gameKey}
                  </td>
                  <td>{where(m.from)}</td>
                  <td className={m.to ? "" : "text-danger"}>{where(m.to)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-6">
          {(
            [
              [
                "Time-slot spread",
                before.timeSlotSpread.value,
                result.metrics.timeSlotSpread.value,
              ],
              [
                "Field spread",
                before.fieldSpread.value,
                result.metrics.fieldSpread.value,
              ],
              [
                "Doubleheader wait",
                before.doubleheaderWait.value,
                result.metrics.doubleheaderWait.value,
              ],
              [
                "Unplaced games",
                before.unplaced.value,
                result.metrics.unplaced.value,
              ],
              [
                "Makeup slots left",
                before.reserveRemaining.value,
                result.metrics.reserveRemaining.value,
              ],
            ] as const
          ).map(([label, was, now]) => (
            <div
              key={label}
              className="flex justify-between gap-3 border-b border-border py-1"
            >
              <dt>{label}</dt>
              <dd>
                {was} → <strong>{now}</strong>
              </dd>
            </div>
          ))}
        </dl>
        {result.schedule.diagnostics
          .filter((d) => !version.schedule.diagnostics.includes(d))
          .map((d) => (
            <p
              key={d}
              role="alert"
              className="rounded-lg border border-warning p-3"
            >
              {d}
            </p>
          ))}
        <form action={declareRainout.bind(null, slug, date)}>
          <button type="submit" className="btn btn-primary">
            Cancel {dayLabel(date)} and save these makeups as a draft
          </button>
        </form>
        <p className="text-text-muted">
          Nothing is published or sent until you publish the draft on the
          schedule screen.
        </p>
      </section>
    );
  }

  return (
    <>
      {header}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Date
          <select
            name="date"
            defaultValue={date ?? undefined}
            className="rounded-md border border-border bg-surface px-2 py-1"
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">
          Preview
        </button>
      </form>
      {preview}
    </>
  );
}
