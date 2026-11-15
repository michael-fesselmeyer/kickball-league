import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InstagramPhotos } from "@/components/instagram-photos";
import { MemberPhotos } from "@/components/member-photos";
import { InviteButton } from "@/components/invite-button";
import { JsonLd } from "@/components/json-ld";
import { PageLoading } from "@/components/page-loading";
import { ShareButtons } from "@/components/share";
import { db } from "@/db/client";
import { eventBySlug, seasonOn } from "@/db/queries/events";
import { approvedPhotos } from "@/db/queries/member-photos";
import { publicTournament } from "@/db/queries/tournaments";
import { TournamentSection } from "./tournament-section";
import { eventPhotos } from "@/db/queries/social";
import {
  KIND_LABELS,
  nextDay,
  rsvpWindow,
  spotsLeft,
  themeWeekDays,
  whenLine,
} from "@/domain/events/event";
import { inviteSite } from "@/domain/events/audience";
import { priceLine } from "@/domain/events/tickets";
import { eventShareText } from "@/domain/share/share-text";
import { env } from "@/env";
import { googleEventLink } from "@/lib/calendar-links";
import {
  eventTag,
  MEMBER_PHOTOS_TAG,
  PHOTOS_TAG,
  PUBLIC_PAGE_LIFE,
} from "@/lib/public-cache";
import { leagueInfo } from "@/lib/seo/league";
import { breadcrumbJsonLd, socialEventJsonLd } from "@/lib/seo/structured-data";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import {
  NO_EVENT,
  publicEventParams,
  type LeagueParams,
} from "@/lib/static-params";
import type { LeagueInfo } from "@/db/queries/leagues";
import type { LeagueId } from "@/domain/ids";
import { leagueHref } from "@/domain/league/paths";
import { cachedLeague, publicLeague } from "@/lib/league/public";

type Props = PageProps<"/l/[league]/events/[event]">;

/** Every event's page is prerendered at build time. */
export async function generateStaticParams(props: LeagueParams) {
  return publicEventParams(props);
}

async function cachedEvent(leagueId: LeagueId, slug: string) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(eventTag(slug));
  return eventBySlug(db, leagueId, slug, "public");
}

/** The first lines of the description, for search results and link previews. */
function summaryOf(description: string, fallback: string): string {
  const text = description.replace(/\s+/g, " ").trim();
  if (text === "") return fallback;
  return text.length <= 155 ? text : `${text.slice(0, 152).trimEnd()}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { league: segment, event: slug } = await params;
  if (slug === NO_EVENT) return { title: "Event" };
  const league = await cachedLeague(segment);
  const e = league ? await cachedEvent(league.id, slug) : null;
  if (!league || !e || e.leagueId !== league.id) return { title: "Event" };
  const when = whenLine(e, e.timeZone);
  return {
    title: e.title,
    description: summaryOf(
      e.description,
      [KIND_LABELS[e.kind], when, e.place].filter(Boolean).join(" · "),
    ),
    alternates: { canonical: leagueHref(league, `/events/${e.slug}`) },
  };
}

export default function EventPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
      <Suspense fallback={<PageLoading>Loading the event…</PageLoading>}>
        <Event {...props} />
      </Suspense>
    </main>
  );
}

async function Event({ params }: Props) {
  const { league: segment, event: slug } = await params;
  // The build's placeholder when it had no database to read.
  if (slug === NO_EVENT) notFound();
  const league = await publicLeague(segment, `/events/${slug}`);
  return <EventDetails league={league} slug={slug} />;
}

function mapLink(place: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

/**
 * Cached, so after the first visit the page is served as static HTML. An
 * admin's edit or an RSVP refreshes it through the event's tag.
 */
async function EventDetails({
  league,
  slug,
}: {
  league: LeagueInfo;
  slug: string;
}) {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(eventTag(slug), PHOTOS_TAG, MEMBER_PHOTOS_TAG);
  const e = await eventBySlug(db, league.id, slug, "public");
  if (!e) notFound();
  const now = new Date();
  const [photos, playerPhotos, tourney] = await Promise.all([
    eventPhotos(db, e.id),
    approvedPhotos(db, { eventId: e.id }),
    e.kind === "tournament" ? publicTournament(db, e, now) : null,
  ]);
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const url = absoluteUrl(origin, `/events/${e.slug}`);
  const themeWeek = e.kind === "theme_week";
  const days = themeWeek ? themeWeekDays(e, e.timeZone) : null;
  const season = days
    ? ((await seasonOn(db, e.leagueId, days.first)) ??
      (await seasonOn(db, e.leagueId, days.last)))
    : null;
  const window = rsvpWindow(e, now);
  const left = spotsLeft(e.capacity, e.going);
  const full = left === 0;
  const price = priceLine(e);
  const when = whenLine(e, e.timeZone);
  const google = googleEventLink({
    title: e.title,
    details: `${e.description}\n\n${url}`.trim(),
    place: e.place,
    start: e.startsAt,
    end: e.endsAt,
    ...(days
      ? { allDay: { first: days.first, afterLast: nextDay(days.last) } }
      : {}),
  });
  const paragraphs = e.description
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <JsonLd
        data={[
          socialEventJsonLd(
            {
              name: e.title,
              url,
              description: e.description,
              startsAt: e.startsAt,
              endsAt: e.endsAt,
              place: e.place ?? undefined,
              cancelled: e.cancelledAt !== null,
              capacity: e.capacity ?? undefined,
              spotsLeft: left ?? undefined,
              priceCents: e.ticketPriceCents ?? undefined,
            },
            leagueInfo(origin),
          ),
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(origin, "/") },
            { name: "Events", url: absoluteUrl(origin, "/events") },
            { name: e.title, url },
          ]),
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href={leagueHref(league, "/events")}
          className="inline-flex min-h-11 items-center text-brand underline"
        >
          All events
        </Link>
      </nav>

      <header className="flex flex-col items-start gap-3">
        {e.cancelledAt ? (
          <p className="rounded-full border-2 border-danger px-3 py-1 text-small font-bold text-danger">
            Called off
          </p>
        ) : (
          <p className="sticker">{KIND_LABELS[e.kind]}</p>
        )}
        <h1
          className={`text-h1 ${e.cancelledAt ? "line-through decoration-4" : ""}`}
        >
          {e.title}
        </h1>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
          <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
            When
          </dt>
          <dd>{when}</dd>
        </div>
        {e.place && (
          <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              Where
            </dt>
            <dd className="flex flex-col gap-1">
              {e.place}
              {e.openPlay && <strong>Open play, no reserved field</strong>}
              <a
                href={mapLink(e.place)}
                className="inline-flex min-h-11 items-center text-brand underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Maps
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </dd>
          </div>
        )}
        {price && (
          <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4 sm:col-span-2">
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              Tickets
            </dt>
            <dd>{price}</dd>
          </div>
        )}
        {!themeWeek && e.inAppRsvp && (
          <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4 sm:col-span-2">
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              Spots
            </dt>
            <dd>
              {e.capacity === null
                ? `No limit. ${e.going === 1 ? "1 person is" : `${e.going} people are`} going.`
                : full
                  ? `All ${e.capacity} spots are taken${e.waitlisted > 0 ? `, and ${e.waitlisted} ${e.waitlisted === 1 ? "person is" : "people are"} on the waitlist` : ""}.`
                  : `${left} of ${e.capacity} spots left.`}
            </dd>
          </div>
        )}
      </dl>

      {paragraphs.length > 0 && (
        <section aria-label="About this event" className="flex flex-col gap-3">
          {paragraphs.map((p, i) => (
            <p key={i} className="max-w-prose text-body-lg whitespace-pre-line">
              {p}
            </p>
          ))}
        </section>
      )}

      {tourney && (
        <TournamentSection slug={e.slug} t={tourney} timeZone={e.timeZone} />
      )}

      {themeWeek && (
        <p className="max-w-prose">
          Theme weeks run on every game day in these dates, and the schedule
          marks them.
          {season && (
            <>
              {" "}
              <Link
                href={leagueHref(league, `/seasons/${season.slug}/schedule`)}
                className="text-brand underline"
              >
                See the {season.name} schedule
              </Link>
              .
            </>
          )}
        </p>
      )}

      {window === "open" && (
        <section
          aria-labelledby="rsvp"
          className="flex flex-col items-start gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <h2 id="rsvp" className="text-h3">
            {full ? "It's full, but spots open up" : "Coming?"}
          </h2>
          <p className="text-small text-text-muted">
            {full
              ? price
                ? "Join the waitlist and you'll get a day to buy the next ticket that opens."
                : "Join the waitlist and we'll email you if someone drops out."
              : price
                ? "Buy your ticket by card or with league credit. Sign in first."
                : "RSVP so the league knows how many to plan for. You can change your mind any time."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/app/events/${e.slug}`} className="btn btn-primary">
              {full ? "Join the waitlist" : price ? "Get a ticket" : "RSVP"}
            </Link>
            {e.inviteUrl && <InviteButton url={e.inviteUrl} />}
          </div>
        </section>
      )}
      {window === "invite_only" && (
        <section
          aria-labelledby="rsvp"
          className="flex flex-col items-start gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <h2 id="rsvp" className="text-h3">
            Coming?
          </h2>
          {e.inviteUrl ? (
            <>
              <p className="text-small text-text-muted">
                The guest list is on {inviteSite(e.inviteUrl)}.
              </p>
              <InviteButton url={e.inviteUrl} primary />
            </>
          ) : (
            <p className="text-small text-text-muted">
              No RSVP needed. Just come along.
            </p>
          )}
        </section>
      )}
      {window === "no_rsvp" && e.inviteUrl && (
        <p>
          <InviteButton url={e.inviteUrl} />
        </p>
      )}
      {window === "over" && (
        <p className="text-text-muted">
          This event is over. Thanks for coming!
        </p>
      )}
      {window === "cancelled" && (
        <p className="text-text-muted">
          The league called this one off.{" "}
          <Link
            href={leagueHref(league, "/events")}
            className="text-brand underline"
          >
            See what else is coming up
          </Link>
          .
        </p>
      )}

      {e.endsAt > now && (
        <section aria-labelledby="share" className="flex flex-col gap-2">
          <h2 id="share" className="text-h3">
            Share this event
          </h2>
          <ShareButtons
            title={e.title}
            text={eventShareText({
              title: e.title,
              kind: KIND_LABELS[e.kind],
              when,
              place: e.place,
              audience: null,
              invite: e.inviteUrl
                ? { site: inviteSite(e.inviteUrl), url: e.inviteUrl }
                : null,
              url,
              cancelled: e.cancelledAt !== null,
            })}
          />
        </section>
      )}

      {!e.cancelledAt && e.endsAt > now && (
        <section aria-labelledby="save" className="flex flex-col gap-2">
          <h2 id="save" className="text-h3">
            Save the date
          </h2>
          <div className="flex flex-wrap gap-2">
            <a
              href={leagueHref(league, `/events/${e.slug}/calendar.ics`)}
              className="btn btn-secondary"
              download
            >
              Apple or Outlook
            </a>
            <a
              href={google}
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Calendar
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </section>
      )}

      <InstagramPhotos
        id="photos"
        heading="Photos"
        cover={null}
        photos={photos}
      />

      {/* Once it has started: there's nothing to photograph before. */}
      {(playerPhotos.length > 0 || e.startsAt <= now) && (
        <MemberPhotos
          id="player-photos"
          about={e.title}
          photos={playerPhotos}
          shareHref={`/app/photos?event=${e.slug}`}
        />
      )}
    </>
  );
}
