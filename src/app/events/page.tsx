import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { EventCard } from "@/components/event-card";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { leagueEvents } from "@/db/queries/events";
import { currentLeague } from "@/db/queries/seasons";
import { env } from "@/env";
import { eventsCalendarLinks } from "@/lib/calendar-links";
import { EVENTS_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { siteOrigin } from "@/lib/site";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";

export const metadata: Metadata = {
  title: "Events",
  description:
    "Bar nights, BBQs, tournaments and theme weeks: the league's social calendar, with RSVPs and a calendar feed.",
  alternates: { canonical: "/events" },
};

/** How many past events the page keeps showing. */
const PAST_SHOWN = 6;

/** A cache life Next.js leaves out of the prerender and reads per request. */
const NOT_KEPT = { stale: 0, revalidate: 0, expire: 0 } as const;

export default function EventsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">
          League <span className="swipe">events</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          The games are the excuse; the people are the point. Come out for a bar
          night, a BBQ, a tournament or a theme week. Every event is optional,
          and you never need to drink to join in.
        </p>
      </header>
      <Suspense fallback={<PageLoading>Loading events…</PageLoading>}>
        <Events />
      </Suspense>
    </main>
  );
}

/**
 * Cached, so the list is served as static HTML; an admin's change or an RSVP
 * refreshes it through the events tag. Until there is a league (a build with
 * an empty or unreachable database, such as the end-to-end tests' build
 * before they seed), nothing is kept, so the first real visit reads the
 * database instead of an empty copy from the build.
 */
async function Events() {
  "use cache";
  cacheTag(EVENTS_TAG);
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const league = await currentLeague(db);
    return {
      league,
      events: league ? await leagueEvents(db, league.id, "public") : [],
    };
  });
  cacheLife(found?.league ? PUBLIC_PAGE_LIFE : NOT_KEPT);
  const events = found?.events ?? [];
  const timeZone = found?.league?.timeZone ?? "America/New_York";
  const now = new Date();
  const upcoming = events.filter((e) => e.endsAt > now);
  const past = events
    .filter((e) => e.endsAt <= now)
    .reverse()
    .slice(0, PAST_SHOWN);
  const links = eventsCalendarLinks(siteOrigin(env.BETTER_AUTH_URL));

  return (
    <>
      <section aria-labelledby="upcoming" className="flex flex-col gap-3">
        <h2 id="upcoming" className="text-h2">
          Coming up
        </h2>
        {upcoming.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
            Nothing on the calendar right now. New events show up here and in
            the calendar feed below as soon as the league posts them.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((e) => (
              <li key={e.id}>
                <EventCard event={e} timeZone={timeZone} now={now} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-small text-text-muted">
          RSVP from an event&apos;s page once you{" "}
          <Link href="/sign-in?next=/app/events" className="underline">
            sign in
          </Link>
          . When an event is full, you can join its waitlist; we&apos;ll email
          you if a spot opens.
        </p>
      </section>

      <section
        aria-labelledby="calendar"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="calendar" className="text-h3">
          Add events to your calendar
        </h2>
        <p className="text-small text-text-muted">
          Subscribe once and new events, changes and call-offs show up on their
          own, in the league&apos;s time zone.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={links.webcal} className="btn btn-primary">
            Apple or Outlook
          </a>
          <a
            href={links.google}
            className="btn btn-secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Calendar
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href="/events/calendar.ics" className="btn btn-secondary" download>
            Download .ics
          </a>
        </div>
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past" className="flex flex-col gap-3">
          <h2 id="past" className="text-h2">
            Recently
          </h2>
          <ul className="flex flex-col gap-3">
            {past.map((e) => (
              <li key={e.id}>
                <EventCard event={e} timeZone={timeZone} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
