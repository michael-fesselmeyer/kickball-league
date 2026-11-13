import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { eventAttendees, eventBySlug } from "@/db/queries/events";
import { eventFormValues, whenLine } from "@/domain/events/event";
import { requirePermission } from "@/lib/auth/permission";
import {
  cancelEventAction,
  deleteEventAction,
  updateEventAction,
} from "../actions";
import { EventFormFields } from "../event-form";

export const metadata: Metadata = { title: "Edit event" };

const ERRORS: Record<string, string> = {
  confirm: "Tick the box to confirm first.",
  already: "That event was already called off.",
  not_found: "That event is gone.",
};

export default function AdminEventPage(
  props: PageProps<"/app/admin/events/[event]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the event…</p>}>
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
  const e = await eventBySlug(db, slug);
  if (!e) notFound();
  const attendees = await eventAttendees(db, e.id);
  const going = attendees.filter((a) => a.status === "going");
  const waiting = attendees.filter((a) => a.status === "waitlisted");
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const promoted = Number(query.promoted ?? 0);
  const saved =
    query.saved === "created"
      ? "Event created. It's on the events page now."
      : query.saved === "updated"
        ? `Saved.${promoted > 0 ? ` ${promoted} ${promoted === 1 ? "person" : "people"} moved up from the waitlist and got an email.` : ""}`
        : query.saved === "cancelled"
          ? `Called off. ${Number(query.notified ?? 0)} people got an email.`
          : undefined;
  const themeWeek = e.kind === "theme_week";

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
        <Link
          href={`/events/${e.slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Public page
        </Link>
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

      {!themeWeek && (
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

      <section aria-labelledby="edit" className="flex flex-col gap-3">
        <h2 id="edit" className="text-h2">
          Edit
        </h2>
        <EventFormFields
          action={updateEventAction.bind(null, e.slug)}
          values={eventFormValues(e, e.timeZone)}
          submitLabel="Save changes"
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
