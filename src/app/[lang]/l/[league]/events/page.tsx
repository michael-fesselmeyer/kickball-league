import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { EventCard } from "@/components/event-card";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { leagueEvents } from "@/db/queries/events";
import { type FriendLeague, featuredFriends } from "@/db/queries/friends";
import { type LeagueInfo, leagueById } from "@/db/queries/leagues";
import { clickPingPath } from "@/domain/friends/clicks";
import { displayHost } from "@/domain/friends/friend-form";
import { env } from "@/env";
import { eventsCalendarLinks } from "@/lib/calendar-links";
import { EVENTS_TAG, FRIENDS_TAG, PUBLIC_PAGE_LIFE } from "@/lib/public-cache";
import { siteOrigin } from "@/lib/site";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { leagueHref } from "@/domain/league/paths";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import type { Locale } from "@/i18n/locales";
import { localeOf, messagesFor } from "@/i18n/messages";
import { languageAlternates, linkIn } from "@/i18n/routing";

type Props = PageProps<"/[lang]/l/[league]/events">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, league: segment } = await params;
  const locale = localeOf(lang);
  const { title, description } = messagesFor(locale).events;
  const league = await cachedLeague(segment);
  const path = league ? leagueHref(league, "/events") : "/events";
  return {
    title,
    description,
    alternates: {
      canonical: linkIn(locale, path),
      languages: languageAlternates(path),
    },
  };
}

/** How many past events the page keeps showing. */
const PAST_SHOWN = 6;

/** A cache life Next.js leaves out of the prerender and reads per request. */
const NOT_KEPT = { stale: 0, revalidate: 0, expire: 0 } as const;

export default async function EventsPage({ params }: Props) {
  const words = messagesFor(localeOf((await params).lang)).events;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">
          {words.headingStart}{" "}
          <span className="swipe">{words.headingSwipe}</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          {words.intro}
        </p>
      </header>
      <Suspense fallback={<PageLoading>{words.loading}</PageLoading>}>
        <LeagueEvents params={params} />
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
async function LeagueEvents({ params }: { params: Props["params"] }) {
  const { league: segment, lang } = await params;
  const league = await publicLeague(segment, "/events");
  return <Events league={league} locale={localeOf(lang)} />;
}

async function Events({
  league: page,
  locale,
}: {
  league: LeagueInfo;
  locale: Locale;
}) {
  "use cache";
  const words = messagesFor(locale).events;
  // Featured clubs come from the friends directory, so its changes refresh
  // this list too.
  cacheTag(EVENTS_TAG, FRIENDS_TAG);
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const league = await leagueById(db, page.id);
    const [events, clubs] = league
      ? await Promise.all([
          leagueEvents(db, league.id, "public"),
          featuredFriends(db, league.id),
        ])
      : [[], []];
    return { league, events, clubs };
  });
  cacheLife(found?.league ? PUBLIC_PAGE_LIFE : NOT_KEPT);
  const events = found?.events ?? [];
  const clubs = found?.clubs ?? [];
  const timeZone = found?.league?.timeZone ?? "America/New_York";
  const now = new Date();
  const upcoming = events.filter((e) => e.endsAt > now);
  const past = events
    .filter((e) => e.endsAt <= now)
    .reverse()
    .slice(0, PAST_SHOWN);
  const links = eventsCalendarLinks(siteOrigin(env.BETTER_AUTH_URL), page);
  const league = page;

  return (
    <>
      <section aria-labelledby="upcoming" className="flex flex-col gap-3">
        <h2 id="upcoming" className="text-h2">
          {words.coming}
        </h2>
        {upcoming.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
            {words.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((e) => (
              <li key={e.id}>
                <EventCard
                  league={league}
                  event={e}
                  timeZone={timeZone}
                  now={now}
                  locale={locale}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-small text-text-muted">
          {words.rsvpStart}{" "}
          <Link href="/sign-in?next=/app/events" className="underline">
            {words.signIn}
          </Link>
          {words.rsvpEnd}
        </p>
      </section>

      {clubs.length > 0 && (
        <section aria-labelledby="clubs" className="flex flex-col gap-3">
          <h2 id="clubs" className="text-h3">
            {words.playerRun}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {clubs.map((c) => (
              <li key={c.id}>
                <ClubCard club={c} anotherSite={words.anotherSite} />
              </li>
            ))}
          </ul>
          <p className="text-small">
            <Link
              href={linkIn(locale, leagueHref(league, "/friends"))}
              className="inline-flex min-h-11 items-center underline"
            >
              {words.moreFriends}
            </Link>
          </p>
        </section>
      )}

      <section
        aria-labelledby="calendar"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="calendar" className="text-h3">
          {words.calendarTitle}
        </h2>
        <p className="text-small text-text-muted">{words.calendarBody}</p>
        <div className="flex flex-wrap gap-2">
          <a href={links.webcal} className="btn btn-primary">
            {words.apple}
          </a>
          <a
            href={links.google}
            className="btn btn-secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            {words.google}
            <span className="sr-only">{words.newTab}</span>
          </a>
          <a
            href={leagueHref(league, "/events/calendar.ics")}
            className="btn btn-secondary"
            download
          >
            {words.ics}
          </a>
        </div>
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past" className="flex flex-col gap-3">
          <h2 id="past" className="text-h2">
            {words.recently}
          </h2>
          <ul className="flex flex-col gap-3">
            {past.map((e) => (
              <li key={e.id}>
                <EventCard
                  league={league}
                  event={e}
                  timeZone={timeZone}
                  now={now}
                  locale={locale}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** A featured club one of our players runs, linked straight to its site. */
function ClubCard({
  club: c,
  anotherSite,
}: {
  club: FriendLeague;
  anotherSite: string;
}) {
  return (
    <article className="flex h-full flex-col gap-1 rounded-card border border-border bg-surface p-4 shadow-card">
      <h3 className="font-display text-h3">{c.name}</h3>
      {c.area && <p className="text-small text-text-muted">{c.area}</p>}
      {c.description && <p className="text-small">{c.description}</p>}
      <a
        href={c.url}
        ping={clickPingPath(c.id)}
        rel="noopener"
        className="inline-block self-start py-3 font-bold break-words underline"
      >
        {displayHost(c.url)}
        <span aria-hidden="true"> ↗</span>
        <span className="sr-only">{anotherSite}</span>
      </a>
    </article>
  );
}
