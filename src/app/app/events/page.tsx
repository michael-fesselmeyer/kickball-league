import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EventCard } from "@/components/event-card";
import { db } from "@/db/client";
import { eventsFor, feedVersion } from "@/db/queries/event-audience";
import { myUpcomingTickets } from "@/db/queries/event-tickets";
import { myEventRsvps } from "@/db/queries/events";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { audienceTag } from "@/domain/events/audience";
import { formatCode } from "@/domain/events/tickets";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { feedLinks } from "@/lib/calendar-links";
import { feedPath, feedToken } from "@/lib/event-feed";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { resetFeedAction } from "./actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Your events" };

export default function MyEventsPage(props: PageProps<"/app/events">) {
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
          What&apos;s coming up for you, including members-only and team events.
          Full events have a waitlist, and we&apos;ll email you if a spot opens.
        </p>
      </header>
      <Suspense fallback={<PageLoading>Loading events…</PageLoading>}>
        <MyEvents {...props} />
      </Suspense>
    </main>
  );
}

const NOTES = { going: "You're going", waitlisted: "You're on the waitlist" };

async function MyEvents({ searchParams }: PageProps<"/app/events">) {
  const subject = await requirePermission("event.rsvp", {
    next: "/app/events",
  });
  const query = await searchParams;
  const league = await currentLeague(db);
  const now = new Date();
  const staff = can(subject, "event.manage", {});
  const [events, version, tickets] = await Promise.all([
    league ? eventsFor(db, league.id, subject.userId, staff) : [],
    feedVersion(db, subject.userId),
    myUpcomingTickets(db, subject.userId, now),
  ]);
  const codes = new Map(tickets.map((t) => [t.eventId, t.code]));
  const upcoming = events.filter((e) => e.endsAt > now);
  const mine = await myEventRsvps(
    db,
    subject.userId,
    upcoming.map((e) => e.id),
  );
  const timeZone = league?.timeZone ?? "America/New_York";
  const feed = feedLinks(
    absoluteUrl(
      siteOrigin(env.BETTER_AUTH_URL),
      feedPath(feedToken(env.BETTER_AUTH_SECRET, subject.userId, version)),
    ),
  );

  return (
    <>
      {upcoming.length === 0 ? (
        <p className="text-text-muted">
          Nothing on the calendar right now. Check back soon.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {upcoming.map((e) => {
            const status = mine.get(e.id);
            const code = codes.get(e.id);
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
                  note={
                    code
                      ? `Your ticket: ${formatCode(code)}`
                      : status
                        ? NOTES[status]
                        : null
                  }
                  tag={audienceTag(e.audience)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <section
        aria-labelledby="feed"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="feed" className="text-h3">
          Your events calendar
        </h2>
        <p className="text-small text-text-muted">
          Every event you can see here, members-only and team events included,
          kept up to date in your calendar app. The link is private to you:
          don&apos;t share it.
        </p>
        {query.feed === "reset" && (
          <p role="status" className="rounded-lg border border-success p-3">
            Done. The old link stopped working; subscribe again with the new
            one.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <a href={feed.webcal} className="btn btn-primary">
            Apple or Outlook
          </a>
          <a
            href={feed.google}
            className="btn btn-secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Calendar
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <form action={resetFeedAction}>
          <button type="submit" className="btn btn-secondary">
            Reset my calendar link
          </button>
        </form>
      </section>
    </>
  );
}
