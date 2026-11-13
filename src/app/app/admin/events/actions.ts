"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  cancelEvent,
  createEvent,
  deleteEvent,
  eventBySlug,
  updateEvent,
} from "@/db/queries/events";
import { currentLeague } from "@/db/queries/seasons";
import {
  EVENT_FORM_ERRORS,
  type EventForm,
  parseEventForm,
} from "@/domain/events/event";
import { requirePermission } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { refreshEventPages } from "@/lib/public-cache";

export type EventFormState = { values: EventForm; error: string | null };

const FIELDS = [
  "kind",
  "title",
  "place",
  "description",
  "capacity",
  "startsOn",
  "startTime",
  "endsOn",
  "endTime",
] as const;

const LIST = "/app/admin/events";

/** An admin adds an event; it shows on the events page at once. */
export async function createEventAction(
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const subject = await requirePermission("event.manage", {
    next: `${LIST}/new`,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const values = formStrings(form, FIELDS);
  const parsed = parseEventForm(values, league.timeZone);
  if (!parsed.ok) return { values, error: EVENT_FORM_ERRORS[parsed.error] };
  const created = await txDb.transaction((tx) =>
    createEvent(tx, {
      leagueId: league.id,
      timeZone: league.timeZone,
      event: parsed.value,
      actorId: subject.userId,
    }),
  );
  refreshEventPages(created.slug, { themeWeek: true });
  redirect(`${LIST}/${created.slug}?saved=created`);
}

/**
 * An admin edits an event. More spots move people up from the waitlist,
 * and they get an email.
 */
export async function updateEventAction(
  slug: string,
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const page = `${LIST}/${slug}`;
  const subject = await requirePermission("event.manage", { next: page });
  const e = await eventBySlug(db, slug);
  if (!e) notFound();
  const values = formStrings(form, FIELDS);
  const parsed = parseEventForm(values, e.timeZone);
  if (!parsed.ok) return { values, error: EVENT_FORM_ERRORS[parsed.error] };
  const saved = await txDb.transaction((tx) =>
    updateEvent(tx, { id: e.id, event: parsed.value, actorId: subject.userId }),
  );
  if (!saved.ok)
    return {
      values,
      error:
        saved.error === "has_rsvps"
          ? "People have RSVP'd, so this can't become a theme week. Make a new theme week instead."
          : "That event is gone.",
    };
  refreshEventPages(slug, { themeWeek: true });
  redirect(
    `${page}?saved=updated${saved.value.promoted.length ? `&promoted=${saved.value.promoted.length}` : ""}`,
  );
}

/** Calls an event off and emails everyone who RSVP'd. */
export async function cancelEventAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `${LIST}/${slug}`;
  const subject = await requirePermission("event.manage", { next: page });
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm`);
  const e = await eventBySlug(db, slug);
  if (!e) notFound();
  const result = await txDb.transaction((tx) =>
    cancelEvent(tx, { id: e.id, actorId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshEventPages(slug, { themeWeek: true });
  redirect(`${page}?saved=cancelled&notified=${result.value.notified}`);
}

/** Takes an event off every page. */
export async function deleteEventAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `${LIST}/${slug}`;
  const subject = await requirePermission("event.manage", { next: page });
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm`);
  const e = await eventBySlug(db, slug);
  if (!e) notFound();
  await txDb.transaction((tx) =>
    deleteEvent(tx, { id: e.id, actorId: subject.userId, now: new Date() }),
  );
  refreshEventPages(slug, { themeWeek: true });
  redirect(`${LIST}?deleted=1`);
}
