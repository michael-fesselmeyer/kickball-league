import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { db } from "@/db/client";
import { divisionsScreen } from "@/db/queries/divisions";
import { schedulerPermits } from "@/db/queries/permit-coverage";
import { loadVersion } from "@/db/queries/schedule";
import {
  scheduleLabels,
  seasonBySlug,
  slotsPastDaylight,
  versionsOf,
} from "@/db/queries/schedule-screen";
import { kickoff } from "@/domain/schedule/format";
import { measure, type Status } from "@/domain/scheduler/measure";
import { validate } from "@/domain/scheduler/validate";
import {
  OVERRIDE_REASON_MAX,
  OVERRIDE_REASON_MIN,
  waiveDocuments,
} from "@/domain/permits/coverage";
import { requirePermission } from "@/lib/auth/permission";
import {
  editGame,
  generateDraft,
  publishDraft,
  publishWithoutDocuments,
  saveBoard,
} from "./actions";
import { BoardLoader } from "./board-loader";
import type { BoardSlot } from "./board-model";
import { metricRows, readable } from "./labels";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeagueId } from "@/lib/league/active";

export const metadata: Metadata = { title: "Build the schedule" };

export default function SchedulePage(
  props: PageProps<"/[lang]/app/admin/seasons/[season]/schedule">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 lg:max-w-6xl">
      <Suspense fallback={<PageLoading>Loading the schedule…</PageLoading>}>
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
  missing_layout:
    "A field this schedule uses has no layout yet. Add one, or confirm none is needed, on the Fields and permits screen.",
  not_draft: "Only a draft can be published.",
  stale:
    "Another version was published after this draft was made, so publishing it would undo that one. Make a new draft from the published schedule.",
  unknown_version: "That version no longer exists.",
  missing_documents:
    "Only permit documents are missing. If the league holds these permits, publish anyway with a reason.",
  reason_short: `Say why in at least ${OVERRIDE_REASON_MIN} characters, such as the permit number and when its document comes.`,
  reason_long: `Keep the reason to ${OVERRIDE_REASON_MAX} characters.`,
};

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
}: PageProps<"/[lang]/app/admin/seasons/[season]/schedule">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/schedule`;
  await requirePermission("schedule.manage", { next: page });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();

  const [versions, divided, dark] = await Promise.all([
    versionsOf(db, season.id),
    divisionsScreen(db, season.leagueId, season.id),
    slotsPastDaylight(db, season.id, season.timeZone),
  ]);
  const latest = versions[0] ? await loadVersion(db, versions[0].id) : null;
  const labels = await scheduleLabels(db, season.id, season.timeZone);
  const metrics = latest ? measure(latest.input, latest.schedule) : null;
  // A draft is judged against the permits as they are now (H12, issue
  // #407), as publishing will judge it.
  const permits =
    latest?.status === "draft"
      ? await schedulerPermits(db, season.id, new Date())
      : null;
  const violations = latest
    ? validate(
        permits ? { ...latest.input, permits } : latest.input,
        latest.schedule,
      )
    : [];
  // Gaps that are only missing documents can be overridden with a reason
  // (ADR 0065); anything else must be fixed.
  const onlyDocuments =
    latest !== null &&
    permits !== null &&
    violations.length > 0 &&
    violations.every((v) => v.rule === "H12") &&
    validate(
      {
        ...latest.input,
        permits: { ...permits, windows: waiveDocuments(permits.windows) },
      },
      latest.schedule,
    ).length === 0;
  const teamCount = labels.teams.size;
  // One full round robin for the largest pool: the season, or the largest
  // division. Crossover games come on top.
  const poolSizes =
    divided.divisions.length > 0
      ? divided.divisions.map(
          (d) => divided.teams.filter((t) => t.divisionId === d.id).length,
        )
      : [teamCount];
  const largest = Math.max(2, ...poolSizes);
  const defaultRounds = largest % 2 === 0 ? largest - 1 : largest;
  const boardSlots: BoardSlot[] = (latest?.input.slots ?? []).flatMap((s) => {
    const where = labels.slots.get(s.id);
    return where
      ? [
          {
            id: s.id,
            date: s.date,
            timeIndex: s.timeIndex,
            fieldId: s.fieldId,
            day: where.day,
            time: where.time,
            field: where.field,
            kind: s.kind,
            cancelled: where.cancelled,
          },
        ]
      : [];
  });
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  // Games in slots that run into the dark on fields without lights (#467):
  // in spring and fall, late slots lose the light.
  const risky = (latest?.schedule.games ?? []).flatMap((g) => {
    const risk = g.slotId ? dark.get(g.slotId) : undefined;
    const where = g.slotId ? labels.slots.get(g.slotId) : undefined;
    return risk && where ? [{ g, risk, where }] : [];
  });

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Schedule</h1>
        <HelpLink
          audience="admin"
          article="schedule"
          topic="making the schedule"
        />
        <Link href={`/app/admin/seasons/${slug}/fields`} className="underline">
          Fields, permits and slots
        </Link>
        <Link
          href={`/app/admin/seasons/${slug}/divisions`}
          className="underline"
        >
          {divided.divisions.length === 0
            ? "Divisions: none, every team plays in one pool"
            : `Divisions: ${divided.divisions
                .map((d, i) => `${d.name} (${poolSizes[i] ?? 0} teams)`)
                .join(", ")}${
                divided.settings.crossoverGames > 0
                  ? `, ${divided.settings.crossoverGames} crossover game${divided.settings.crossoverGames === 1 ? "" : "s"} a team`
                  : ""
              }`}
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
              defaultValue={defaultRounds}
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
          <SubmitButton className="btn btn-primary">Generate</SubmitButton>
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
                <SubmitButton className="btn btn-primary">
                  Publish version {latest.versionNo}
                </SubmitButton>
              </form>
            )}
          </div>
          {latest.status === "draft" &&
            violations.length === 0 &&
            metrics.unplaced.value > 0 && (
              <p className="rounded-lg border border-warning p-3">
                {metrics.unplaced.value === 1
                  ? "1 game has"
                  : `${metrics.unplaced.value} games have`}{" "}
                no time yet. Publishing leaves{" "}
                {metrics.unplaced.value === 1 ? "it" : "them"} off the schedule
                until you place {metrics.unplaced.value === 1 ? "it" : "them"}:
                add dates or slots, or lower the makeup reserve, and generate
                again.
              </p>
            )}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {metricRows(metrics).map(({ label, metric, best }) => (
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

          {risky.length > 0 && (
            <section
              aria-labelledby="daylight"
              className="flex flex-col gap-2 rounded-lg border border-warning p-3"
            >
              <h3 id="daylight" className="text-h3">
                {risky.length === 1
                  ? "1 game runs past daylight"
                  : `${risky.length} games run past daylight`}
              </h3>
              <p className="text-small text-text-muted">
                These slots end after play must stop on a field without lights.
                Move them earlier or to a lit field, or mark the field as lit on
                the fields screen if it has lights.
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {risky.map(({ g, risk, where }) => (
                  <li key={g.key}>
                    {where.day} {where.time}, {where.field}:{" "}
                    {labels.teams.get(g.teamA) ?? "?"} vs{" "}
                    {labels.teams.get(g.teamB) ?? "?"}, {risk.minutesShort}{" "}
                    minute{risk.minutesShort === 1 ? "" : "s"} past daylight
                    (sunset {kickoff(risk.sunsetAt, season.timeZone)})
                  </li>
                ))}
              </ul>
            </section>
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
          {latest.status === "draft" && onlyDocuments && (
            <form
              action={publishWithoutDocuments.bind(null, slug, latest.id)}
              className="flex flex-col gap-2 rounded-lg border-2 border-warning p-3"
            >
              <p>
                Only permit documents are missing. If the league holds these
                permits, you can publish now: say why, and it goes in the audit
                log. Owners can upload the documents on the permits screen.
              </p>
              <label htmlFor="override-reason" className="font-bold">
                Why publish before the documents are uploaded?
              </label>
              <textarea
                id="override-reason"
                name="reason"
                required
                rows={2}
                minLength={OVERRIDE_REASON_MIN}
                maxLength={OVERRIDE_REASON_MAX}
                className="rounded-md border border-border bg-surface px-2 py-2"
              />
              <SubmitButton className="btn self-start btn-secondary">
                Publish version {latest.versionNo} anyway
              </SubmitButton>
            </form>
          )}

          <BoardLoader
            key={latest.id}
            versionNo={latest.versionNo}
            input={latest.input}
            schedule={latest.schedule}
            slots={boardSlots}
            teams={Object.fromEntries(labels.teams)}
            save={saveBoard.bind(null, slug, latest.id)}
          >
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
          </BoardLoader>

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
            <SubmitButton className="btn self-start btn-secondary">
              Save as a new draft
            </SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
