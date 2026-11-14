import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { myPrivateEvents } from "@/db/queries/private-events";
import { currentLeague } from "@/db/queries/seasons";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = {
  title: "Your private leagues and tournaments",
};

const PAGE = "/app/private-events";

const STATUS = {
  requested: "Waiting for the league",
  accepted: "Set up",
  declined: "Declined",
} as const;

export default function MyPrivateEventsPage(
  props: PageProps<"/app/private-events">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<div className="min-h-svh" aria-busy="true" />}>
        <MyEvents {...props} />
      </Suspense>
    </main>
  );
}

async function MyEvents({ searchParams }: PageProps<"/app/private-events">) {
  const subject = await requirePermission("private_event.request", {
    next: PAGE,
  });
  const query = await searchParams;
  const league = await currentLeague(db);
  const events = league
    ? await myPrivateEvents(db, league.id, subject.userId)
    : [];
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Private leagues and tournaments</h1>
        <p className="text-text-muted">
          Your requests to the league and the private events it set up for you.
        </p>
        <Link href={`${PAGE}/new`} className="btn self-start btn-primary">
          Request a booking
        </Link>
      </header>
      {query.sent === "1" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Request sent. We emailed you a confirmation, and an admin will be in
          touch.
        </p>
      )}
      {events.length === 0 ? (
        <p className="text-text-muted">No requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-1 rounded-lg border border-border p-4"
            >
              <h2 className="text-h3">{e.seasonName ?? e.organization}</h2>
              <p className="text-small text-text-muted">
                {e.kind === "tournament" ? "Tournament" : "Private league"} ·{" "}
                {e.teams} teams · {e.preferredDates}
              </p>
              <p>
                <strong>{STATUS[e.status]}</strong>
              </p>
              {e.status === "accepted" && e.seasonSlug && (
                <Link
                  href={`${PAGE}/${e.seasonSlug}`}
                  className="btn self-start btn-secondary"
                >
                  Open the organizer page
                  <span className="sr-only"> for {e.seasonName}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
