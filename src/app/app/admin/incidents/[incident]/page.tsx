import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  earlierAlcoholSuspensions,
  incidentDetail,
} from "@/db/queries/discipline";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import {
  describeLength,
  INCIDENT_KINDS,
  MAX_GAMES,
  NOTE_MAX,
  suggestedLength,
  type SuspensionLength,
} from "@/domain/discipline/discipline";
import { type IncidentId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import {
  addNoteAction,
  liftAction,
  setStatusAction,
  suspendAction,
} from "../actions";
import { REPORTED_BY, suspensionLine } from "../words";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Incident" };

export default function IncidentPage(
  props: PageProps<"/app/admin/incidents/[incident]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the report…</PageLoading>}>
        <Incident {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  no_note: "Write the note first.",
  note_too_long: `Keep notes under ${NOTE_MAX} characters.`,
  bad_scope: "Choose how long the suspension is.",
  bad_games: `Enter a number of games from 1 to ${MAX_GAMES}.`,
  not_involved: "Only people named on the report can be suspended from it.",
  already_suspended: "That person is already suspended from this report.",
  already_resolved: "This report is already resolved.",
  not_resolved: "This report is already open.",
  already_lifted: "That suspension was already lifted.",
  not_found: "That report is gone.",
};

const NOTICES: Record<string, string> = {
  noted: "Note added.",
  resolved: "Resolved. It moves out of the review queue.",
  open: "Reopened. It's back in the review queue.",
  suspended: "Suspended. They've been emailed the length and how to appeal.",
  lifted: "Suspension lifted.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

function SuspendForm({
  action,
  name,
  suggested,
  idPrefix,
}: {
  action: (form: FormData) => Promise<void>;
  name: string;
  suggested: SuspensionLength | null;
  idPrefix: string;
}) {
  const scope = suggested?.scope ?? "games";
  return (
    <form action={action} className="flex flex-col gap-3">
      {suggested && (
        <p className="text-small">
          Rulebook 4.0 suggests {describeLength(suggested)} for {name}, from
          their history.
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">Suspend {name} for</legend>
        <label className="flex flex-wrap items-center gap-2">
          <input
            type="radio"
            name="scope"
            value="games"
            defaultChecked={scope === "games"}
          />
          <span id={`${idPrefix}-games-label`}>A number of games:</span>
          <input
            type="number"
            name="games"
            min={1}
            max={MAX_GAMES}
            defaultValue={suggested?.scope === "games" ? suggested.games : 1}
            aria-labelledby={`${idPrefix}-games-label`}
            className={`${field} w-20`}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="scope"
            value="season"
            defaultChecked={scope === "season"}
          />
          The rest of the season
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="scope"
            value="permanent"
            defaultChecked={scope === "permanent"}
          />
          Permanently
        </label>
      </fieldset>
      <SubmitButton className="btn self-start btn-primary">
        Suspend {name}
      </SubmitButton>
    </form>
  );
}

async function Incident({
  params,
  searchParams,
}: PageProps<"/app/admin/incidents/[incident]">) {
  await requireFeature("discipline");
  const { incident: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("incident.review", {
    next: `/app/admin/incidents/${rawId}`,
  });
  const id = parseId<IncidentId>(rawId);
  const now = new Date();
  const found = id ? await incidentDetail(db, id, now) : null;
  if (!found) notFound();
  const mayCall = can(subject, "player.suspend");
  const league = await currentLeague(db);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  const suspendedHere = new Set(found.suspensions.map((s) => s.userId));
  const toDecide = found.people.filter((p) => !suspendedHere.has(p.userId));
  const history = new Map(
    await Promise.all(
      toDecide.map(
        async (p) =>
          [
            p.userId,
            await earlierAlcoholSuspensions(db, p.userId, found.id),
          ] as const,
      ),
    ),
  );
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const g = found.game;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/incidents" className="underline">
          Incidents
        </Link>
        <h1 className="text-h1">{INCIDENT_KINDS[found.kind]}</h1>
        <p className="text-text-muted">
          <Link href={`/app/games/${g.id}/score`} className="underline">
            {g.teamAName} vs {g.teamBName}
          </Link>
          {g.startsAt && ` · ${when(g.startsAt)}`} · {g.seasonName}
        </p>
        <p className="text-small text-text-muted">
          {found.status === "open" ? "Open" : "Resolved"} · reported by{" "}
          {REPORTED_BY[found.reporterRole]}
          {found.reporterName ? ` (${found.reporterName})` : ""},{" "}
          {when(found.reportedAt)}
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}

      <section aria-labelledby="what" className="flex flex-col gap-2">
        <h2 id="what" className="text-h2">
          What happened
        </h2>
        <p className="whitespace-pre-line">{found.details}</p>
        <h3 className="text-h3">People involved</h3>
        {found.people.length === 0 ? (
          <p className="text-text-muted">Nobody was named.</p>
        ) : (
          <ul className="list-disc pl-5">
            {found.people.map((p) => (
              <li key={p.userId}>
                {p.name}
                {p.teamName && (
                  <span className="text-text-muted"> · {p.teamName}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        id="suspensions"
        aria-labelledby="suspensions-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="suspensions-heading" className="text-h2">
          Suspensions
        </h2>
        {found.suspensions.length === 0 ? (
          <p className="text-text-muted">
            Nobody is suspended from this report.
          </p>
        ) : (
          <ul className="flex flex-col">
            {found.suspensions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
              >
                <span>
                  <strong>{s.name}</strong>
                  <span className="text-small text-text-muted">
                    {" "}
                    · {suspensionLine(s)}
                  </span>
                </span>
                {mayCall && s.state.state === "active" && (
                  <form action={liftAction.bind(null, found.id, s.id)}>
                    <SubmitButton className="btn btn-secondary">
                      Lift {s.name}&apos;s suspension
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {mayCall && toDecide.length > 0 && (
          <div id="suspend" className="flex flex-col gap-6">
            {toDecide.map((p, i) => (
              <div
                key={p.userId}
                className="rounded-lg border border-border p-4"
              >
                <SuspendForm
                  action={suspendAction.bind(null, found.id, p.userId)}
                  name={p.name}
                  suggested={suggestedLength(
                    found.kind,
                    history.get(p.userId) ?? 0,
                  )}
                  idPrefix={`suspend-${i}`}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        id="notes"
        aria-labelledby="notes-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="notes-heading" className="text-h2">
          Notes
        </h2>
        {found.notes.length === 0 ? (
          <p className="text-text-muted">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {found.notes.map((n) => (
              <li key={n.id} className="border-t border-border pt-2">
                <p className="whitespace-pre-line">{n.body}</p>
                <p className="text-small text-text-muted">
                  {n.authorName ?? "An admin"}, {when(n.writtenAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form
          action={addNoteAction.bind(null, found.id)}
          className="flex flex-col gap-2"
        >
          <label htmlFor="incident-note">Add a note</label>
          <textarea
            id="incident-note"
            name="note"
            rows={3}
            maxLength={NOTE_MAX}
            required
            className={field}
          />
          <SubmitButton className="btn self-start btn-secondary">
            Add note
          </SubmitButton>
        </form>
      </section>

      <form
        action={setStatusAction.bind(
          null,
          found.id,
          found.status === "open" ? "resolved" : "open",
        )}
      >
        <SubmitButton className="btn btn-primary">
          {found.status === "open" ? "Mark resolved" : "Reopen"}
        </SubmitButton>
      </form>
    </>
  );
}
