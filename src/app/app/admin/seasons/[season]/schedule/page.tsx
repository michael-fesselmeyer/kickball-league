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
import { measure, type Metric, type Status } from "@/domain/scheduler/measure";
import { validate } from "@/domain/scheduler/validate";
import { requirePermission } from "@/lib/auth/permission";
import { editGame, generateDraft, publishDraft } from "./actions";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage(
  props: PageProps<"/app/admin/seasons/[season]/schedule">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading the schedule…</p>}>
        <Schedule {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  bad_input: "Rounds, makeup reserve and seed must be whole numbers in range.",
  slot_taken: "That slot already holds a game.",
  unknown_game: "That game is not in this version.",
  unknown_slot: "That slot does not exist.",
  has_violations: "This version breaks a hard rule, so it cannot be published.",
  not_draft: "Only a draft can be published.",
  unknown_version: "That version no longer exists.",
};

/**
 * The scheduler names games by key (`r3:<team id>:<team id>`) and teams by
 * id; this shows team names instead.
 */
function readable(note: string, teams: ReadonlyMap<string, string>) {
  return note
    .replace(
      /r(\d+):([0-9a-f-]{36}):([0-9a-f-]{36})/g,
      (key, round: string, a: string, b: string) =>
        teams.has(a) && teams.has(b)
          ? `${teams.get(a)} vs ${teams.get(b)} (round ${round})`
          : key,
    )
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (id) => teams.get(id) ?? id);
}

/** "1 game", "3 games", from a search parameter. */
function count(value: string | string[] | undefined, noun: string) {
  const n = Number(value ?? 0);
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

const STATUS_STYLE: Record<Status, string> = {
  good: "text-success",
  review: "text-warning",
  poor: "text-danger",
};

async function Schedule({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/schedule">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/schedule`;
  await requirePermission("schedule.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();

  const versions = await versionsOf(db, season.id);
  const latest = versions[0] ? await loadVersion(db, versions[0].id) : null;
  const labels = await scheduleLabels(db, season.id, season.timeZone);
  const metrics = latest ? measure(latest.input, latest.schedule) : null;
  const violations = latest ? validate(latest.input, latest.schedule) : [];
  const teamCount = labels.teams.size;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Schedule</h1>
        <Link href={`/app/admin/seasons/${slug}/fields`} className="underline">
          Fields, permits and slots
        </Link>
        {versions.some((v) => v.status === "published") && (
          <Link
            href={`/app/admin/seasons/${slug}/rainout`}
            className="underline"
          >
            Call a rain-out
          </Link>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {query.rainout && (
        <p role="status" className="rounded-lg border border-success p-3">
          Rain-out saved as a draft with the makeups. Publish it to make it
          live.
        </p>
      )}
      {query.edited && (
        <p role="status" className="rounded-lg border border-success p-3">
          Saved as a new draft. Check its problems before publishing.
        </p>
      )}
      {query.published && (
        <p role="status" className="rounded-lg border border-success p-3">
          Published. {count(query.moved, "game")} moved,{" "}
          {count(query.added, "game")} added and {count(query.removed, "game")}{" "}
          removed; {count(query.teams, "team")} affected.
          {Number(query.notified) > 0 &&
            ` ${count(query.notified, "rain-out email")} queued for players.`}
        </p>
      )}

      <section aria-labelledby="generate" className="flex flex-col gap-3">
        <h2 id="generate" className="text-h2">
          Generate a draft
        </h2>
        <form
          action={generateDraft.bind(null, slug)}
          className="flex flex-wrap items-end gap-4"
        >
          <label className="flex flex-col gap-1">
            Rounds
            <input
              name="rounds"
              type="number"
              min={1}
              max={60}
              required
              defaultValue={teamCount % 2 === 0 ? teamCount - 1 : teamCount}
              className="w-24 rounded-md border border-border bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            Makeup slots kept free each day
            <input
              name="reserve"
              type="number"
              min={0}
              max={20}
              required
              defaultValue={2}
              className="w-24 rounded-md border border-border bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            Seed
            <input
              name="seed"
              type="number"
              min={0}
              required
              defaultValue={versions.length + 1}
              className="w-24 rounded-md border border-border bg-surface px-2 py-1"
            />
          </label>
          <button type="submit" className="btn btn-primary">
            Generate
          </button>
        </form>
      </section>

      <section aria-labelledby="versions" className="flex flex-col gap-3">
        <h2 id="versions" className="text-h2">
          Versions
        </h2>
        {versions.length === 0 ? (
          <p className="text-text-muted">
            No versions yet. Generate one to start.
          </p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-text-muted">
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col">How</th>
                <th scope="col">Problems</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-border">
                  <td>{v.versionNo}</td>
                  <td>{v.status}</td>
                  <td>{v.origin.replace("_", " ")}</td>
                  <td>{v.violations === 0 ? "None" : v.violations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {latest && metrics && (
        <section aria-labelledby="latest" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="latest" className="text-h2">
              Version {latest.versionNo} ({latest.status})
            </h2>
            {latest.status === "draft" && violations.length === 0 && (
              <form action={publishDraft.bind(null, slug, latest.id)}>
                <button type="submit" className="btn btn-primary">
                  Publish version {latest.versionNo}
                </button>
              </form>
            )}
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {(
              [
                [
                  "Time-slot spread",
                  metrics.timeSlotSpread,
                  metrics.timeSlotSpread.bestPossible,
                ],
                [
                  "Field spread",
                  metrics.fieldSpread,
                  metrics.fieldSpread.bestPossible,
                ],
                ["Longest same-slot streak", metrics.longestStreak, null],
                ["Doubleheader wait", metrics.doubleheaderWait, null],
                ["Bye balance", metrics.byeBalance, null],
                ["Unplaced games", metrics.unplaced, null],
                ["Makeup slots left", metrics.reserveRemaining, null],
              ] as [string, Metric, number | null][]
            ).map(([label, metric, best]) => (
              <div
                key={label}
                className="flex justify-between gap-3 border-b border-border py-1"
              >
                <dt>{label}</dt>
                <dd className={STATUS_STYLE[metric.status]}>
                  {metric.value}{" "}
                  <span className="text-text-muted">
                    ({metric.status}
                    {best !== null && metric.value === best
                      ? ", best possible"
                      : ""}
                    )
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          {latest.schedule.diagnostics.length > 0 && (
            <ul
              aria-label="Notes from the scheduler"
              className="flex list-disc flex-col gap-1 pl-5"
            >
              {latest.schedule.diagnostics.map((d) => (
                <li key={d}>{readable(d, labels.teams)}</li>
              ))}
            </ul>
          )}

          {violations.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-danger">
              {violations.map((v) => (
                <li key={`${v.rule}:${v.message}`}>
                  {v.rule}: {readable(v.message, labels.teams)}
                </li>
              ))}
            </ul>
          )}

          <form
            action={editGame.bind(null, slug, latest.id)}
            aria-labelledby="edit"
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <h3 id="edit" className="text-h3">
              Move or swap a game
            </h3>
            <p className="text-text-muted">
              Pick a game and where it should go. If that slot holds a game, the
              two swap. The change is saved as a new draft.
            </p>
            <label className="flex flex-col gap-1">
              Game
              <select
                name="game"
                required
                className="rounded-md border border-border bg-surface px-2 py-1"
              >
                {[...latest.schedule.games]
                  .sort(
                    (a, b) => a.round - b.round || a.key.localeCompare(b.key),
                  )
                  .map((g) => (
                    <option key={g.key} value={g.key}>
                      Round {g.round}: {labels.teams.get(g.teamA) ?? g.teamA} vs{" "}
                      {labels.teams.get(g.teamB) ?? g.teamB}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              To
              <select
                name="slot"
                required
                className="rounded-md border border-border bg-surface px-2 py-1"
              >
                {[...labels.slots]
                  .filter(([, where]) => !where.cancelled)
                  .sort(
                    ([, a], [, b]) =>
                      a.startsAt.getTime() - b.startsAt.getTime(),
                  )
                  .map(([id, where]) => {
                    const taken = latest.schedule.games.find(
                      (g) => g.slotId === id,
                    );
                    return (
                      <option key={id} value={id}>
                        {where.day}, {where.time}, {where.field}
                        {taken
                          ? ` (${labels.teams.get(taken.teamA) ?? ""} vs ${labels.teams.get(taken.teamB) ?? ""})`
                          : " (empty)"}
                      </option>
                    );
                  })}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="pin" defaultChecked />
              Pin it there, so regenerating keeps it
            </label>
            <button type="submit" className="btn self-start btn-secondary">
              Save as a new draft
            </button>
          </form>

          <table className="w-full text-left">
            <caption className="sr-only">
              Games in version {latest.versionNo}
            </caption>
            <thead className="text-text-muted">
              <tr>
                <th scope="col">When</th>
                <th scope="col">Field</th>
                <th scope="col">Game</th>
              </tr>
            </thead>
            <tbody>
              {[...latest.schedule.games]
                .sort(
                  (a, b) =>
                    (labels.slots.get(a.slotId ?? "")?.startsAt.getTime() ??
                      Infinity) -
                      (labels.slots.get(b.slotId ?? "")?.startsAt.getTime() ??
                        Infinity) || a.key.localeCompare(b.key),
                )
                .map((g) => {
                  const where = g.slotId
                    ? labels.slots.get(g.slotId)
                    : undefined;
                  return (
                    <tr key={g.key} className="border-t border-border">
                      <td>
                        {where ? `${where.day}, ${where.time}` : "Not placed"}
                      </td>
                      <td>{where?.field ?? "—"}</td>
                      <td>
                        {labels.teams.get(g.teamA) ?? g.teamA} vs{" "}
                        {labels.teams.get(g.teamB) ?? g.teamB}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
