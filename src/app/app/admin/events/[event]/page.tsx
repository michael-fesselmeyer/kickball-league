import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CopyForWhatsApp } from "@/components/share";
import { db } from "@/db/client";
import { audienceChoices, audienceNames } from "@/db/queries/event-audience";
import { eventTickets } from "@/db/queries/event-tickets";
import { eventAttendees, eventBySlug } from "@/db/queries/events";
import {
  audienceLine,
  audienceShareLine,
  inviteHost,
  reachFormValues,
} from "@/domain/events/audience";
import { eventFormValues, KIND_LABELS, whenLine } from "@/domain/events/event";
import { isTicketed, ticketPriceFormValues } from "@/domain/events/tickets";
import { eventShareText } from "@/domain/share/share-text";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import {
  cancelEventAction,
  deleteEventAction,
  updateEventAction,
} from "../actions";
import { EventFormFields } from "../event-form";
import { EventTickets } from "./tickets";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Edit event" };

const ERRORS: Record<string, string> = {
  confirm: "Tick the box to confirm first.",
  already: "That event was already called off.",
  not_found: "That event is gone.",
  has_tickets:
    "People hold tickets or are checking out right now. Refund every ticket first; a checkout runs out within the hour.",
  stale: "For your security, sign in again before refunding a ticket.",
  not_paid: "That ticket isn't paid, so there's nothing to refund.",
  nothing_left: "That ticket's payment is already refunded.",
  bad_amount: "That refund amount doesn't work.",
  too_much: "That's more than is left on the payment.",
  refund_failed: "Stripe didn't take the refund. Nothing changed; try again.",
  payments_off:
    "Online payments aren't set up, so Stripe refunds can't go out.",
  bad_code: "A check-in code is 6 letters and numbers, like K7M 4QX.",
  unknown_code: "No paid ticket for this event has that code.",
  already_in: "That ticket is already checked in.",
};

export default function AdminEventPage(
  props: PageProps<"/app/admin/events/[event]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the event…</PageLoading>}>
        <AdminEvent {...props} />
      </Suspense>
    </main>
  );
}

async function AdminEvent({
  params,
  searchParams,
}: PageProps<"/app/admin/events/[event]">) {
  const { event: slug } = await params;
  const query = await searchParams;
  await requirePermission("event.manage", {
    next: `/app/admin/events/${slug}`,
  });
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  const now = new Date();
  const [attendees, choices, names, tickets] = await Promise.all([
    eventAttendees(db, e.id),
    audienceChoices(db, e.leagueId),
    audienceNames(db, e.audience),
    eventTickets(db, e.id, now),
  ]);
  const ticketed = isTicketed(e) || tickets.holders.length > 0;
  const isPublic = e.audience.kind === "public";
  const told =
    typeof query.told === "string" ? ` ${toldLine(Number(query.told))}` : "";
  const going = attendees.filter((a) => a.status === "going");
  const waiting = attendees.filter((a) => a.status === "waitlisted");
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const promoted = Number(query.promoted ?? 0);
  const saved =
    query.saved === "created"
      ? `Event created. ${isPublic ? "It's on the events page now." : "The people it's for see it in the app now."}${told}`
      : query.saved === "updated"
        ? `Saved.${promoted > 0 ? ` ${promoted} ${promoted === 1 ? "person" : "people"} moved up from the waitlist and got an email.` : ""}${told}`
        : query.saved === "cancelled"
          ? `Called off. ${Number(query.notified ?? 0)} people got an email.`
          : query.saved === "refunded"
            ? "Refunded. The ticket is cancelled, the buyer got an email, and the spot went to the waitlist."
            : undefined;
  const themeWeek = e.kind === "theme_week";
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const shareText = eventShareText({
    title: e.title,
    kind: KIND_LABELS[e.kind],
    when: whenLine(e, e.timeZone),
    place: e.place,
    audience: audienceShareLine(e.audience, names),
    invite: e.inviteUrl
      ? { host: inviteHost(e.inviteUrl), url: e.inviteUrl }
      : null,
    url: absoluteUrl(
      origin,
      isPublic ? `/events/${e.slug}` : `/app/events/${e.slug}`,
    ),
    cancelled: e.cancelledAt !== null,
  });

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin/events"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Events
        </Link>
        <h1 className="text-h1">{e.title}</h1>
        <p>{whenLine(e, e.timeZone)}</p>
        <p>
          <span className="font-bold">For:</span>{" "}
          {audienceLine(e.audience, names)}
        </p>
        {e.inviteUrl && (
          <p className="break-all">
            <span className="font-bold">Invite:</span> {e.inviteUrl}
          </p>
        )}
        <Link
          href={isPublic ? `/events/${e.slug}` : `/app/events/${e.slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {isPublic ? "Public page" : "Event page in the app"}
        </Link>
        {!themeWeek && (
          <Link
            href={`/app/admin/events/${e.slug}/giveaway`}
            className="inline-flex min-h-11 items-center self-start underline"
          >
            Giveaway
          </Link>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      {e.cancelledAt && (
        <p className="rounded-lg border-2 border-danger p-3 font-bold">
          This event is called off.
        </p>
      )}

      <section
        aria-labelledby="share"
        className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="share" className="text-h3">
          For the group chat
        </h2>
        <p className="text-small text-text-muted">
          A ready-to-paste message with the date, place
          {e.inviteUrl ? ", invite link" : ""} and the event&apos;s page.
        </p>
        <CopyForWhatsApp text={shareText} about={e.title} />
      </section>

      {!themeWeek && e.inAppRsvp && (
        <section aria-labelledby="who" className="flex flex-col gap-3">
          <h2 id="who" className="text-h2">
            Who&apos;s coming ({going.length}
            {e.capacity !== null ? ` of ${e.capacity}` : ""})
          </h2>
          {going.length === 0 ? (
            <p className="text-text-muted">No RSVPs yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {going.map((a) => (
                <li key={a.userId}>{a.name}</li>
              ))}
            </ul>
          )}
          {waiting.length > 0 && (
            <>
              <h3 className="text-h3">Waitlist ({waiting.length})</h3>
              <ol className="flex list-decimal flex-col gap-1 pl-6">
                {waiting.map((a) => (
                  <li key={a.userId}>{a.name}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {ticketed && (
        <EventTickets
          slug={e.slug}
          prices={e}
          capacity={e.capacity}
          holders={tickets.holders}
          checkingOut={tickets.checkingOut}
          offered={tickets.offered}
          timeZone={e.timeZone}
          checkedIn={
            typeof query.checkedIn === "string" ? query.checkedIn : null
          }
        />
      )}

      <section aria-labelledby="edit" className="flex flex-col gap-3">
        <h2 id="edit" className="text-h2">
          Edit
        </h2>
        <EventFormFields
          action={updateEventAction.bind(null, e.slug)}
          values={eventFormValues(e, e.timeZone)}
          reach={reachFormValues(e, choices)}
          prices={ticketPriceFormValues(e)}
          choices={choices}
          submitLabel="Save changes"
          announceLabel="Email everyone it's for about this change"
        />
      </section>

      <section
        aria-labelledby="danger"
        className="flex flex-col gap-4 rounded-card border-2 border-danger p-4"
      >
        <h2 id="danger" className="text-h2">
          Call off or delete
        </h2>
        {!e.cancelledAt && (
          <form
            action={cancelEventAction.bind(null, e.slug)}
            className="flex flex-col items-start gap-2"
          >
            <p>
              Calling it off keeps the page up with a notice, clears every RSVP
              and emails{" "}
              {attendees.length === 1
                ? "the 1 person"
                : `the ${attendees.length} people`}{" "}
              who RSVP&apos;d.
            </p>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                required
                className="size-5 accent-brand"
              />
              Yes, call it off
            </label>
            <button type="submit" className="btn btn-secondary">
              Call off the event
            </button>
          </form>
        )}
        <form
          action={deleteEventAction.bind(null, e.slug)}
          className="flex flex-col items-start gap-2"
        >
          <p>
            Deleting takes it off every page without telling anyone. Use it for
            a mistake, not a change of plans.
          </p>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="confirm"
              value="yes"
              required
              className="size-5 accent-brand"
            />
            Yes, delete it
          </label>
          <button type="submit" className="btn btn-secondary">
            Delete the event
          </button>
        </form>
      </section>
    </>
  );
}

/** How many people the admin's message went to. */
function toldLine(n: number): string {
  if (n === 0) return "No one new to email.";
  return `${n === 1 ? "1 person" : `${n} people`} will get an email.`;
}
