import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  earlierAlcoholSuspensions,
  earlierEjections,
  incidentDetail,
  seasonGameCounts,
} from "@/db/queries/discipline";
import { cardsForPlayers } from "@/db/queries/cards";
import { injuryOf, recordInjuryView } from "@/db/queries/injury";
import { can } from "@/domain/authz/permissions";
import { cardName, patternNote } from "@/domain/discipline/cards";
import {
  describeLength,
  INCIDENT_KINDS,
  MAX_GAMES,
  NOTE_MAX,
  suggestedLength,
  type SuspensionLength,
} from "@/domain/discipline/discipline";
import {
  BODY_AREAS,
  CARE_LEVELS,
  injuryRemovalDate,
} from "@/domain/discipline/injury";
import { type IncidentId, parseId, type TeamSeasonId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { requireInLeague } from "@/lib/league/guard";
import { requireFeature } from "@/lib/platform/site";
import {
  addNoteAction,
  deleteInjuryAction,
  liftAction,
  setStatusAction,
  suspendAction,
} from "../actions";
import { REPORTED_BY, suspensionLine } from "../words";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Incident" };

export default function IncidentPage(
  props: PageProps<"/[lang]/app/admin/incidents/[incident]">,
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
  injury_deleted: "The injury details were deleted.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

function SuspendForm({
  action,
  name,
  suggested,
  fullSeason,
  idPrefix,
}: {
  action: (form: FormData) => Promise<void>;
  name: string;
  suggested: SuspensionLength | null;
  /** The suggestion is one full season, counted in the team's games. */
  fullSeason: boolean;
  idPrefix: string;
}) {
  const scope = suggested?.scope ?? "games";
  return (
    <form action={action} className="flex flex-col gap-3">
      {suggested && (
        <p className="text-small">
          Rulebook 4.0 suggests {describeLength(suggested)}
          {fullSeason &&
            suggested.scope === "games" &&
            " (one full season)"}{" "}
          for {name}, from their history. You can change it.
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
}: PageProps<"/[lang]/app/admin/incidents/[incident]">) {
  await requireFeature("discipline");
  const { incident: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("incident.review", {
    next: `/app/admin/incidents/${rawId}`,
  });
  const id = parseId<IncidentId>(rawId);
  if (!id) notFound();
  await requireInLeague(subject, { incident: id });
  const now = new Date();
  const found = await incidentDetail(db, id, now);
  if (!found) notFound();
  // An injury report holds health details: only owners and admins read it,
  // and each time one is opened it is in the audit log.
  const isInjury = found.kind === "injury";
  const mayReadInjury = isInjury && can(subject, "injury.read");
  const injury = mayReadInjury ? await injuryOf(db, found.id) : null;
  if (injury)
    await recordInjuryView(db, {
      incidentId: found.id,
      actorId: subject.userId,
    });
  const mayCall = can(subject, "player.suspend");
  const league = await activeLeague();
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
  const teams = [
    ...new Set(
      found.people.flatMap((p) => (p.teamSeasonId ? [p.teamSeasonId] : [])),
    ),
  ] as TeamSeasonId[];
  const [alcohol, ejections, seasonGames, cards] = await Promise.all([
    Promise.all(
      toDecide.map(
        async (p) =>
          [
            p.userId,
            await earlierAlcoholSuspensions(db, p.userId, found.id),
          ] as const,
      ),
    ),
    // An injury report names nobody, so this finds nothing for one.
    earlierEjections(
      db,
      found.people.map((p) => p.userId),
      found.id,
    ),
    seasonGameCounts(db, teams),
    cardsForPlayers(
      db,
      found.people.map((p) => p.userId),
    ),
  ]);
  const history = new Map(alcohol);
  const cardLines = new Map(
    found.people.flatMap((p) => {
      const mine = cards.get(p.userId) ?? [];
      if (mine.length === 0) return [];
      const names = mine.map((c) => cardName(c.color)).join(", ");
      const pattern = patternNote(mine);
      return [[p.userId, `Cards: ${names}${pattern ? ` · ${pattern}` : ""}`]];
    }),
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
        {isInjury && (
          <>
            {injury ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-text-muted">Person hurt</dt>
                  <dd>{injury.hurtName ?? "Removed with their account"}</dd>
                  <dt className="text-text-muted">Body area</dt>
                  <dd>{BODY_AREAS[injury.bodyArea]}</dd>
                  <dt className="text-text-muted">Care</dt>
                  <dd>{CARE_LEVELS[injury.care]}</dd>
                  <dt className="text-text-muted">Witnesses</dt>
                  <dd>
                    {injury.witnesses.length > 0
                      ? injury.witnesses.join(", ")
                      : "None named"}
                  </dd>
                </dl>
                <p className="text-small text-text-muted">
                  Only owners and admins can read this, and each time it is
                  opened, exported or deleted it is in the audit log. The
                  details are removed on{" "}
                  {when(injuryRemovalDate(found.reportedAt))}.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={`/app/admin/incidents/${found.id}/injury.csv`}
                    className="btn btn-secondary"
                  >
                    Download for the insurance carrier
                  </a>
                  <form action={deleteInjuryAction.bind(null, found.id)}>
                    <SubmitButton className="btn btn-secondary">
                      Delete the injury details now
                    </SubmitButton>
                  </form>
                </div>
              </>
            ) : null}
          </>
        )}
        {!isInjury && <h3 className="text-h3">People involved</h3>}
        {isInjury ? null : found.people.length === 0 ? (
          <p className="text-text-muted">Nobody was named.</p>
        ) : (
          <ul className="list-disc pl-5">
            {found.people.map((p) => {
              const earlier = ejections.get(p.userId) ?? [];
              return (
                <li key={p.userId}>
                  {p.name}
                  {p.teamName && (
                    <span className="text-text-muted"> · {p.teamName}</span>
                  )}
                  {earlier.length > 0 && (
                    <div className="text-small">
                      <p className="font-semibold">
                        {earlier.length === 1
                          ? "Ejected once before:"
                          : `Ejected ${earlier.length} times before:`}
                      </p>
                      <ul className="list-disc pl-5">
                        {earlier.map((e) => (
                          <li key={e.incidentId}>
                            <Link
                              href={`/app/admin/incidents/${e.incidentId}`}
                              className="underline"
                            >
                              {when(e.reportedAt)}, {e.seasonName}
                            </Link>
                            : {e.details}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {cardLines.get(p.userId) && (
                    <span className="block text-small text-text-muted">
                      {cardLines.get(p.userId)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!isInjury && (
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
                      p.teamSeasonId
                        ? (seasonGames.get(p.teamSeasonId) ?? null)
                        : null,
                    )}
                    fullSeason={
                      found.kind === "outside_alcohol" &&
                      history.get(p.userId) === 1
                    }
                    idPrefix={`suspend-${i}`}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

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
