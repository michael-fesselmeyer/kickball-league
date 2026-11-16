import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  dayFields,
  fieldChecksOn,
  seasonChecklist,
  setupLeadShifts,
} from "@/db/queries/game-day-checklist";
import {
  CHECKLIST_PHASES,
  MOVE_OUTCOMES,
  NOTE_MAX,
  OUTCOME_LABELS,
  PHASE_LABELS,
} from "@/domain/gameday/checklist";
import { fullWhen, kickoff } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { FieldCheckForm, gameDayError } from "@/components/field-check-form";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { closeCheckAction, moveAction, setupCheckAction } from "./actions";

export const metadata: Metadata = {
  title: "Set-up lead",
  robots: { index: false },
};

/**
 * The set-up lead's game-day checklist (issue #409), for whoever claimed
 * the season's "Set-up lead" shift that day: each field with its permit,
 * the admins' script for asking park users to move, a one-tap note of how
 * that went, and the set-up and "left clean" checks.
 */
export default function SetupLeadPage(
  props: PageProps<"/[lang]/app/setup-lead">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-h1">Set-up lead</h1>
      <Suspense
        fallback={<PageLoading>Loading today&apos;s fields…</PageLoading>}
      >
        <SetupLead {...props} />
      </Suspense>
    </main>
  );
}

const field = "rounded-md border border-border bg-surface px-2 py-2";

async function SetupLead({
  searchParams,
}: PageProps<"/[lang]/app/setup-lead">) {
  const subject = await requirePermission("public.view", {
    next: "/app/setup-lead",
  });
  const league = await activeLeague();
  if (!league) return <p>No league yet.</p>;
  const now = new Date();
  const tz = league.timeZone;
  const today = localDay(now, tz);
  const shifts = (await setupLeadShifts(db, subject.userId, tz, now)).filter(
    (s) => s.leagueId === league.id,
  );
  const todays = shifts.filter((s) => s.date === today);
  const later = shifts.filter((s) => s.date > today);
  const query = await searchParams;
  const error = gameDayError(
    typeof query.error === "string" ? query.error : undefined,
  );
  const notice = typeof query.notice === "string" ? query.notice : null;

  const days = await Promise.all(
    todays.map(async (s) => {
      const [fields, checks, list] = await Promise.all([
        dayFields(db, s.seasonId, today, tz),
        fieldChecksOn(db, s.seasonId, today),
        seasonChecklist(db, s.seasonId),
      ]);
      return { shift: s, fields, checks, list };
    }),
  );

  return (
    <>
      {error && (
        <p role="alert" className="rounded-lg border-2 border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="font-bold">
          {notice === "setup"
            ? "Set-up saved."
            : notice === "closed"
              ? "Saved. Thanks for closing out the field."
              : notice === "moved_fine"
                ? "Noted."
                : "Noted. The admins will see it on the incidents screen."}
        </p>
      )}
      {days.length === 0 && (
        <p>
          You don&apos;t lead set-up today.{" "}
          <Link href="/app/volunteer" className="underline">
            Claim a set-up lead shift
          </Link>{" "}
          to get the checklist on that game day.
        </p>
      )}
      {days.map(({ shift, fields, checks, list }) => (
        <section
          key={shift.shiftId}
          aria-labelledby={`season-${shift.seasonId}`}
          className="flex flex-col gap-4"
        >
          <h2 id={`season-${shift.seasonId}`} className="text-h2">
            {shift.seasonName}, today
          </h2>
          <div className="flex flex-col gap-1">
            <h3 className="text-h3">Asking people to move</h3>
            <p className="rounded-lg border border-border p-3 whitespace-pre-line">
              {list.script}
            </p>
            <p className="text-small text-text-muted">
              Only you ask, and only before play.
            </p>
          </div>
          {CHECKLIST_PHASES.map((p) => (
            <div key={p} className="flex flex-col gap-1">
              <h3 className="text-h3">{PHASE_LABELS[p]}</h3>
              <ul className="list-disc pl-6">
                {list.items[p].map((i) => (
                  <li key={i.id}>{i.text}</li>
                ))}
              </ul>
            </div>
          ))}
          {fields.length === 0 && <p>No games on the schedule today.</p>}
          {fields.map((f) => {
            const check = checks.get(f.fieldId);
            const bind = [shift.seasonId, f.fieldId] as const;
            return (
              <article
                key={f.fieldId}
                id={`field-${f.fieldId}`}
                className="flex flex-col gap-3 rounded-lg border border-border p-3"
              >
                <header>
                  <h3 className="text-h3">
                    {f.venueName}, {f.fieldName}
                  </h3>
                  <p className="text-small text-text-muted">
                    {kickoff(f.firstStartsAt, tz)} to{" "}
                    {kickoff(f.lastEndsAt, tz)}
                  </p>
                </header>
                <Link
                  href={`/app/games/${f.firstGameId}/permit`}
                  className="btn self-start btn-secondary"
                >
                  Open the permit
                </Link>
                <details open={!check?.setup}>
                  <summary className="font-bold">Set-up</summary>
                  <FieldCheckForm
                    kind="setup"
                    action={setupCheckAction.bind(null, ...bind)}
                    saved={check?.setup ?? null}
                    timeZone={tz}
                    idPrefix={`setup-${f.fieldId}`}
                  />
                </details>
                <form
                  action={moveAction.bind(null, ...bind)}
                  className="flex flex-col gap-2"
                >
                  <p className="font-bold">Asked a group to move?</p>
                  <label
                    htmlFor={`move-note-${f.fieldId}`}
                    className="flex flex-col gap-1"
                  >
                    <span className="text-small">Note (optional)</span>
                    <input
                      id={`move-note-${f.fieldId}`}
                      name="note"
                      maxLength={NOTE_MAX}
                      className={field}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {MOVE_OUTCOMES.map((o) => (
                      <SubmitButton
                        key={o}
                        name="outcome"
                        value={o}
                        className={`btn ${o === "fine" ? "btn-primary" : "btn-secondary"}`}
                      >
                        {OUTCOME_LABELS[o]}
                      </SubmitButton>
                    ))}
                  </div>
                </form>
                <details open={!!check?.setup && !check.close}>
                  <summary className="font-bold">
                    After the last game ({kickoff(f.lastEndsAt, tz)})
                  </summary>
                  <FieldCheckForm
                    kind="close"
                    action={closeCheckAction.bind(null, ...bind)}
                    saved={check?.close ?? null}
                    timeZone={tz}
                    idPrefix={`close-${f.fieldId}`}
                  />
                </details>
              </article>
            );
          })}
        </section>
      ))}
      {later.length > 0 && (
        <section aria-labelledby="later" className="flex flex-col gap-1">
          <h2 id="later" className="text-h2">
            Coming up
          </h2>
          <ul>
            {later.map((s) => (
              <li key={s.shiftId}>
                {s.seasonName}: {fullWhen(s.startsAt, tz)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
