import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InviteButton } from "@/components/invite-button";
import { CopyForWhatsApp } from "@/components/share";
import { db } from "@/db/client";
import { creditBalance } from "@/db/queries/credit";
import {
  audienceNames,
  viewerOf,
  visibleEvent,
} from "@/db/queries/event-audience";
import { myTicket, spotCounts } from "@/db/queries/event-tickets";
import { myEventRsvp } from "@/db/queries/events";
import { can } from "@/domain/authz/permissions";
import { audienceShareLine, inviteHost } from "@/domain/events/audience";
import {
  KIND_LABELS,
  nextDay,
  rsvpWindow,
  spotsLeft,
  themeWeekDays,
  whenLine,
} from "@/domain/events/event";
import { isTicketed } from "@/domain/events/tickets";
import { eventShareText } from "@/domain/share/share-text";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { googleEventLink } from "@/lib/calendar-links";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { joinEventAction, leaveEventAction } from "../actions";
import { TicketPanel } from "./ticket";

export const metadata: Metadata = { title: "RSVP" };

const ERRORS: Record<string, string> = {
  not_found: "That event is gone.",
  cancelled: "The league called this event off.",
  over: "This event is over.",
  no_rsvp: "Theme weeks don't need an RSVP. Just show up on game day.",
  invite_only: "This event takes RSVPs on its invite, not here.",
  ticketed: "This event needs a ticket. Buy one below.",
  has_ticket:
    "You have a ticket. To give it up, ask the league for a refund; your spot goes to the waitlist.",
  free: "This event is free now: just RSVP.",
  going: "You already have a spot.",
  payments_off:
    "Online payment isn't set up yet, so tickets can't be sold right now.",
  checkout_failed:
    "We couldn't start the checkout. Nothing was charged; try again.",
  checkout_open: "Your checkout is still open. Try again in a moment.",
};

const DONE: Record<string, string> = {
  going: "You're going. See you there!",
  waitlisted:
    "It's full, so you're on the waitlist. We'll email you if a spot opens.",
  left: "Done. Your RSVP is cleared.",
};

const TICKET: Record<string, string> = {
  paid: "Thanks! Your ticket is below.",
  cancelled: "Checkout cancelled. Nothing was charged.",
};

export default function EventRsvpPage(props: PageProps<"/app/events/[event]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the event…</p>}>
        <EventRsvp {...props} />
      </Suspense>
    </main>
  );
}

async function EventRsvp({
  params,
  searchParams,
}: PageProps<"/app/events/[event]">) {
  const { event: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("event.rsvp", {
    next: `/app/events/${slug}`,
  });
  const e = await visibleEvent(
    db,
    slug,
    subject.userId,
    can(subject, "event.manage", {}),
  );
  if (!e) notFound();
  const now = new Date();
  const ticketed = isTicketed(e);
  const [mine, names, ticket, viewer, credit, spots] = await Promise.all([
    myEventRsvp(db, e.id, subject.userId),
    audienceNames(db, e.audience),
    ticketed ? myTicket(db, e.id, subject.userId, now) : null,
    ticketed
      ? viewerOf(
          db,
          e.leagueId,
          subject.userId,
          can(subject, "event.manage", {}),
        )
      : null,
    ticketed ? creditBalance(db, subject.userId) : 0,
    ticketed ? spotCounts(db, e, now) : null,
  ]);
  const window = rsvpWindow(e, now);
  const isPublic = e.audience.kind === "public";
  const when = whenLine(e, e.timeZone);
  const url = absoluteUrl(
    siteOrigin(env.BETTER_AUTH_URL),
    isPublic ? `/events/${e.slug}` : `/app/events/${e.slug}`,
  );
  const days = e.kind === "theme_week" ? themeWeekDays(e, e.timeZone) : null;
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
  const left = spotsLeft(e.capacity, e.going);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;
  const returned = typeof query.ticket === "string" ? query.ticket : null;
  const ticketDone =
    returned === "paid" && ticket?.status === "paid"
      ? TICKET.paid
      : returned === "cancelled"
        ? TICKET.cancelled
        : undefined;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href="/app/events"
          className="inline-flex min-h-11 items-center underline"
        >
          Your events
        </Link>
      </nav>
      <header className="flex flex-col gap-1">
        <p className="text-small font-bold text-text-muted">
          {KIND_LABELS[e.kind]}
        </p>
        <h1 className="text-h1">{e.title}</h1>
        <p>{when}</p>
        {e.place && <p className="text-text-muted">{e.place}</p>}
        {isPublic ? (
          <Link
            href={`/events/${e.slug}`}
            className="inline-flex min-h-11 items-center self-start underline"
          >
            Event details
          </Link>
        ) : (
          <p className="text-small font-bold">
            For {audienceShareLine(e.audience, names)}
          </p>
        )}
      </header>

      {!isPublic && paragraphs.length > 0 && (
        <section aria-label="About this event" className="flex flex-col gap-3">
          {paragraphs.map((p, i) => (
            <p key={i} className="max-w-prose whitespace-pre-line">
              {p}
            </p>
          ))}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {(done ?? ticketDone) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {done ?? ticketDone}
        </p>
      )}

      <section
        aria-labelledby="rsvp"
        className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="rsvp" className="text-h2">
          {ticketed ? "Your ticket" : "Your RSVP"}
        </h2>
        {window === "open" && ticketed && spots && viewer ? (
          <TicketPanel
            slug={e.slug}
            prices={e}
            member={viewer.member}
            ticket={ticket}
            rsvp={mine}
            spots={spots}
            creditCents={credit}
            timeZone={e.timeZone}
            returned={returned}
          />
        ) : window === "no_rsvp" ? (
          <p>{ERRORS.no_rsvp}</p>
        ) : window === "invite_only" ? (
          e.inviteUrl ? (
            <>
              <p>RSVP on the event&apos;s invite.</p>
              <InviteButton url={e.inviteUrl} primary />
            </>
          ) : (
            <p>No RSVP needed. Just come along.</p>
          )
        ) : window !== "open" ? (
          <p>{ERRORS[window]}</p>
        ) : mine?.status === "going" ? (
          <>
            <p className="text-body-lg font-bold">You&apos;re going.</p>
            <p className="text-text-muted">
              Plans changed? Drop your spot so the next person on the waitlist
              gets it.
            </p>
            <form action={leaveEventAction.bind(null, e.slug)}>
              <button type="submit" className="btn btn-secondary">
                I can&apos;t make it
              </button>
            </form>
          </>
        ) : mine?.status === "waitlisted" ? (
          <>
            <p className="text-body-lg font-bold">
              You&apos;re number {mine.position} on the waitlist.
            </p>
            <p className="text-text-muted">
              If someone drops out, the first person in line gets their spot and
              an email.
            </p>
            <form action={leaveEventAction.bind(null, e.slug)}>
              <button type="submit" className="btn btn-secondary">
                Leave the waitlist
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-text-muted">
              {left === null
                ? "No limit on this one: bring your team."
                : left === 0
                  ? `All ${e.capacity} spots are taken. Join the waitlist and you'll get the next one that opens.`
                  : `${left} of ${e.capacity} spots left.`}
            </p>
            <form action={joinEventAction.bind(null, e.slug)}>
              <button type="submit" className="btn btn-primary">
                {left === 0 ? "Join the waitlist" : "I'm going"}
              </button>
            </form>
          </>
        )}
        {window === "open" && e.inviteUrl && (
          <p className="flex flex-col items-start gap-2 text-small text-text-muted">
            The league also has an invite for this one.
            <InviteButton url={e.inviteUrl} />
          </p>
        )}
      </section>

      {!e.cancelledAt && e.endsAt > now && (
        <section aria-labelledby="share" className="flex flex-col gap-3">
          <h2 id="share" className="text-h3">
            Save and share
          </h2>
          <div className="flex flex-wrap gap-2">
            <a
              href={google}
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Add to Google Calendar
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <Link href="/app/events#feed" className="btn btn-secondary">
              Your calendar feed
            </Link>
          </div>
          <CopyForWhatsApp
            about={e.title}
            text={eventShareText({
              title: e.title,
              kind: KIND_LABELS[e.kind],
              when,
              place: e.place,
              audience: audienceShareLine(e.audience, names),
              invite: e.inviteUrl
                ? { host: inviteHost(e.inviteUrl), url: e.inviteUrl }
                : null,
              url,
              cancelled: false,
            })}
          />
        </section>
      )}
    </>
  );
}
