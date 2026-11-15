import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { activeLeague } from "@/lib/league/active";
import { upcomingShifts, upcomingVolunteers } from "@/db/queries/volunteer";
import { whenLine } from "@/domain/events/event";
import { ROLE_LABELS, spotsLine } from "@/domain/volunteer/shifts";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Volunteer shifts" };

export default function VolunteerAdminPage(
  props: PageProps<"/app/admin/volunteer">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Volunteer shifts</h1>
        <p className="text-text-muted">
          Post shifts for game days and events. Members sign up in the app and
          get a reminder the day before.
        </p>
      </header>
      <Suspense fallback={<p className="min-h-svh">Loading shifts…</p>}>
        <Shifts {...props} />
      </Suspense>
    </main>
  );
}

const SAVED: Record<string, string> = {
  created: "Shift posted. Members can sign up now.",
  updated: "Shift saved.",
  removed: "Shift removed.",
};

async function Shifts({ searchParams }: PageProps<"/app/admin/volunteer">) {
  await requirePermission("volunteer.manage", { next: "/app/admin/volunteer" });
  const query = await searchParams;
  await connection();
  const league = await activeLeague();
  const now = new Date();
  const [shifts, volunteers] = league
    ? await Promise.all([
        upcomingShifts(db, league.id, now),
        upcomingVolunteers(db, league.id, now),
      ])
    : [[], []];
  const timeZone = league?.timeZone ?? "America/New_York";
  const saved =
    typeof query.saved === "string" ? SAVED[query.saved] : undefined;

  return (
    <>
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      <Link
        href="/app/admin/volunteer/new"
        className="btn self-start btn-primary"
      >
        Post a shift
      </Link>
      {shifts.length === 0 ? (
        <p className="text-text-muted">No shifts coming up.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shifts.map((s) => {
            const names = volunteers
              .filter((v) => v.shiftId === s.id)
              .map((v) => v.name);
            const label = `${ROLE_LABELS[s.role]}, ${s.occasionName}`;
            return (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-card border-2 border-border p-4"
              >
                <h2 className="text-h3">{label}</h2>
                <p>
                  {whenLine(
                    { kind: "social", startsAt: s.startsAt, endsAt: s.endsAt },
                    timeZone,
                  )}
                  {s.place && `, ${s.place}`}
                </p>
                <p>
                  {s.taken} of {s.spots} signed up ·{" "}
                  {spotsLine(s.spots, s.taken)}
                </p>
                {names.length > 0 ? (
                  <ul
                    aria-label={`Signed up for ${label}`}
                    className="list-disc pl-6"
                  >
                    {names.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-text-muted">No one yet.</p>
                )}
                <Link
                  href={`/app/admin/volunteer/${s.id}`}
                  className="inline-flex min-h-11 items-center self-start underline"
                  aria-label={`Edit ${label}`}
                >
                  Edit
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
