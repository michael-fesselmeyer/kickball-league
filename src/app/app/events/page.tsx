import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EventCard } from "@/components/event-card";
import { db } from "@/db/client";
import { leagueEvents, myEventRsvps } from "@/db/queries/events";
import { currentLeague } from "@/db/queries/seasons";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Your events" };

export default function MyEventsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Home
        </Link>
        <h1 className="text-h1">Events</h1>
        <p className="text-text-muted">
          RSVP to what&apos;s coming up. Full events have a waitlist, and
          we&apos;ll email you if a spot opens.
        </p>
      </header>
      <Suspense fallback={<p className="min-h-svh">Loading events…</p>}>
        <MyEvents />
      </Suspense>
    </main>
  );
}

const NOTES = { going: "You're going", waitlisted: "You're on the waitlist" };

async function MyEvents() {
  const subject = await requirePermission("event.rsvp", {
    next: "/app/events",
  });
  const league = await currentLeague(db);
  const now = new Date();
  const upcoming = league
    ? (await leagueEvents(db, league.id)).filter((e) => e.endsAt > now)
    : [];
  const mine = await myEventRsvps(
    db,
    subject.userId,
    upcoming.map((e) => e.id),
  );
  const timeZone = league?.timeZone ?? "America/New_York";

  if (upcoming.length === 0)
    return (
      <p className="text-text-muted">
        Nothing on the calendar right now. Check back soon.
      </p>
    );
  return (
    <ul className="flex flex-col gap-3">
      {upcoming.map((e) => {
        const status = mine.get(e.id);
        return (
          <li key={e.id}>
            <EventCard
              event={e}
              timeZone={timeZone}
              now={now}
              href={
                e.kind === "theme_week"
                  ? `/events/${e.slug}`
                  : `/app/events/${e.slug}`
              }
              note={status ? NOTES[status] : null}
            />
          </li>
        );
      })}
    </ul>
  );
}
