import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { activeLeague } from "@/lib/league/active";
import { myShiftIds, upcomingShifts } from "@/db/queries/volunteer";
import { whenLine } from "@/domain/events/event";
import {
  CLAIM_REFUSALS,
  ROLE_HINTS,
  ROLE_LABELS,
  spotsLeft,
  spotsLine,
} from "@/domain/volunteer/shifts";
import { requirePermission } from "@/lib/auth/permission";
import { claimShiftAction, dropShiftAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Volunteer" };

export default function VolunteerPage(props: PageProps<"/app/volunteer">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Home
        </Link>
        <h1 className="text-h1">Volunteer</h1>
        <p className="text-text-muted">
          Game days and events run on volunteers. Grab a shift, and we&apos;ll
          remind you the day before. Plans change? Drop it so someone else can
          take it.
        </p>
      </header>
      <Suspense fallback={<p className="min-h-svh">Loading shifts…</p>}>
        <Shifts {...props} />
      </Suspense>
    </main>
  );
}

const NOTICES: Record<string, string> = {
  claimed: "You're on the shift. Thanks for helping out!",
  dropped: "You've dropped the shift.",
};

const ERRORS: Record<string, string> = {
  ...CLAIM_REFUSALS,
  not_found: "That shift is gone.",
  not_on: "You weren't on that shift.",
};

async function Shifts({ searchParams }: PageProps<"/app/volunteer">) {
  const subject = await requirePermission("volunteer.claim", {
    next: "/app/volunteer",
  });
  const query = await searchParams;
  await connection();
  const league = await activeLeague();
  const now = new Date();
  const shifts = league ? await upcomingShifts(db, league.id, now) : [];
  const mine = await myShiftIds(
    db,
    subject.userId,
    shifts.map((s) => s.id),
  );
  const timeZone = league?.timeZone ?? "America/New_York";
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const yours = shifts.filter((s) => mine.has(s.id));

  return (
    <>
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {yours.length > 0 && (
        <section aria-labelledby="yours" className="flex flex-col gap-2">
          <h2 id="yours" className="text-h2">
            Your shifts
          </h2>
          <ul className="flex flex-col gap-1">
            {yours.map((s) => (
              <li key={s.id}>
                <a
                  href={`#shift-${s.id}`}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {ROLE_LABELS[s.role]}, {s.occasionName}:{" "}
                  {whenLine(
                    { kind: "social", startsAt: s.startsAt, endsAt: s.endsAt },
                    timeZone,
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="open" className="flex flex-col gap-3">
        <h2 id="open" className="text-h2">
          Shifts coming up
        </h2>
        {shifts.length === 0 ? (
          <p className="text-text-muted">
            No shifts posted right now. Check back before the next game day.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shifts.map((s) => {
              const on = mine.has(s.id);
              const started = now >= s.startsAt;
              const full = spotsLeft(s.spots, s.taken) === 0;
              const label = `${ROLE_LABELS[s.role]}, ${s.occasionName}`;
              return (
                <li
                  key={s.id}
                  id={`shift-${s.id}`}
                  className="flex scroll-mt-4 flex-col gap-2 rounded-card border-2 border-border p-4"
                >
                  <h3 className="text-h3">{ROLE_LABELS[s.role]}</h3>
                  <p className="font-bold">
                    {s.eventSlug ? (
                      <Link
                        href={`/app/events/${s.eventSlug}`}
                        className="underline"
                      >
                        {s.occasionName}
                      </Link>
                    ) : (
                      s.occasionName
                    )}
                  </p>
                  <p>
                    {whenLine(
                      {
                        kind: "social",
                        startsAt: s.startsAt,
                        endsAt: s.endsAt,
                      },
                      timeZone,
                    )}
                    {s.place && `, ${s.place}`}
                  </p>
                  <p className="text-text-muted">{ROLE_HINTS[s.role]}</p>
                  {s.notes && <p className="whitespace-pre-line">{s.notes}</p>}
                  <p>
                    {on && (
                      <>
                        <strong>You&apos;re on this shift.</strong>{" "}
                      </>
                    )}
                    {spotsLine(s.spots, s.taken)}
                  </p>
                  {started ? (
                    <p className="text-text-muted">Under way.</p>
                  ) : on ? (
                    <form action={dropShiftAction.bind(null, s.id)}>
                      <SubmitButton
                        className="btn btn-secondary"
                        aria-label={`Drop this shift: ${label}`}
                      >
                        Drop this shift
                      </SubmitButton>
                    </form>
                  ) : full ? null : (
                    <form action={claimShiftAction.bind(null, s.id)}>
                      <SubmitButton
                        className="btn btn-primary"
                        aria-label={`Sign up for ${label}`}
                      >
                        Sign up
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
