"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { announceEvent, audienceChoices } from "@/db/queries/event-audience";
import {
  cancelEvent,
  createEvent,
  deleteEvent,
  eventBySlug,
  updateEvent,
} from "@/db/queries/events";
import { currentLeague } from "@/db/queries/seasons";
import {
  parseReach,
  REACH_ERRORS,
  type ReachForm,
} from "@/domain/events/audience";
import {
  EVENT_FORM_ERRORS,
  type EventForm,
  parseEventForm,
} from "@/domain/events/event";
import {
  parseTicketPrices,
  TICKET_PRICE_ERRORS,
  type TicketPriceForm,
} from "@/domain/events/tickets";
import type { LeagueId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { refreshEventPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

export type EventFormState = {
  values: EventForm;
  reach: ReachForm;
  prices: TicketPriceForm;
  announce: boolean;
  error: string | null;
};

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

/** Who the event is for, as the form sent it. */
function reachStrings(form: FormData): ReachForm {
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    audience: text("audience"),
    season: text("season"),
    teams: form.getAll("team").filter((v) => typeof v === "string"),
    inviteUrl: text("inviteUrl"),
    inAppRsvp: text("inAppRsvp"),
  };
}

/**
 * Checks the whole form: the event, then who it's for against the seasons
 * and teams the league has.
 */
async function readForm(form: FormData, leagueId: LeagueId, timeZone: string) {
  const values = formStrings(form, FIELDS);
  const reachValues = reachStrings(form);
  const priceValues = formStrings(form, ["price", "memberPrice"] as const);
  const announce = form.get("announce") === "yes";
  const fail = (error: string) => ({
    ok: false as const,
    state: {
      values,
      reach: reachValues,
      prices: priceValues,
      announce,
      error,
    },
  });
  const parsed = parseEventForm(values, timeZone);
  if (!parsed.ok) return fail(EVENT_FORM_ERRORS[parsed.error]);
  const reach = parseReach(
    reachValues,
    parsed.value.kind,
    await audienceChoices(db, leagueId),
  );
  if (!reach.ok) return fail(REACH_ERRORS[reach.error]);
  const prices = parseTicketPrices(priceValues, parsed.value.kind);
  if (!prices.ok) return fail(TICKET_PRICE_ERRORS[prices.error]);
  if (prices.value.ticketPriceCents !== null && !reach.value.inAppRsvp)
    return fail(
      "Tickets are sold in the app, so keep RSVPs in the app on for a ticketed event.",
    );
  return {
    ok: true as const,
    event: parsed.value,
    reach: reach.value,
    prices: prices.value,
    announce,
    fail,
  };
}

/** An admin adds an event; it shows on the events page at once. */
export async function createEventAction(
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const subject = await requirePermissionToChange("event.manage", {
    next: `${LIST}/new`,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const read = await readForm(form, league.id, league.timeZone);
  if (!read.ok) return read.state;
  const { created, told } = await txDb.transaction(async (tx) => {
    const created = await createEvent(tx, {
      leagueId: league.id,
      timeZone: league.timeZone,
      event: read.event,
      reach: read.reach,
      prices: read.prices,
      actorId: subject.userId,
    });
    const told = read.announce
      ? await announceEvent(tx, {
          eventId: created.id,
          kind: "announced",
          now: new Date(),
        })
      : 0;
    return { created, told };
  });
  if (told) sendQueuedSoon();
  refreshEventPages(created.slug, { themeWeek: true });
  redirect(
    `${LIST}/${created.slug}?saved=created${read.announce ? `&told=${told}` : ""}`,
  );
}

/**
 * An admin edits an event. More spots move people up from the waitlist,
 * and they get an email; the admin can also tell everyone it's for.
 */
export async function updateEventAction(
  slug: string,
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const page = `${LIST}/${slug}`;
  const subject = await requirePermissionToChange("event.manage", {
    next: page,
  });
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  const read = await readForm(form, e.leagueId, e.timeZone);
  if (!read.ok) return read.state;
  const saved = await txDb.transaction(async (tx) => {
    const updated = await updateEvent(tx, {
      id: e.id,
      event: read.event,
      reach: read.reach,
      prices: read.prices,
      actorId: subject.userId,
      now: new Date(),
    });
    const told =
      updated.ok && read.announce
        ? await announceEvent(tx, {
            eventId: e.id,
            kind: "updated",
            now: new Date(),
            change: {
              timeOrPlace:
                e.startsAt.getTime() !== read.event.startsAt.getTime() ||
                e.endsAt.getTime() !== read.event.endsAt.getTime() ||
                e.place !== read.event.place,
              startedBefore: e.startsAt,
            },
          })
        : 0;
    return { updated, told };
  });
  if (!saved.updated.ok)
    return read.fail(SAVE_ERRORS[saved.updated.error]).state;
  const promoted = saved.updated.value.promoted.length;
  if (promoted || saved.told) sendQueuedSoon();
  refreshEventPages(slug, { themeWeek: true });
  redirect(
    `${page}?saved=updated${promoted ? `&promoted=${promoted}` : ""}${read.announce ? `&told=${saved.told}` : ""}`,
  );
}

const SAVE_ERRORS = {
  has_rsvps:
    "People have RSVP'd, so this can't become a theme week. Make a new theme week instead.",
  rsvps_in_app:
    "People have RSVP'd here, so RSVPs in the app have to stay on for this event.",
  has_tickets:
    "People have tickets, so this event stays paid. Refund the tickets first to make it free.",
  not_found: "That event is gone.",
} as const;

/** Calls an event off and emails everyone who RSVP'd. */
export async function cancelEventAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `${LIST}/${slug}`;
  const subject = await requirePermissionToChange("event.manage", {
    next: page,
  });
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm`);
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  const result = await txDb.transaction((tx) =>
    cancelEvent(tx, { id: e.id, actorId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  if (result.value.notified) sendQueuedSoon();
  refreshEventPages(slug, { themeWeek: true });
  redirect(`${page}?saved=cancelled&notified=${result.value.notified}`);
}

/** Takes an event off every page. */
export async function deleteEventAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `${LIST}/${slug}`;
  const subject = await requirePermissionToChange("event.manage", {
    next: page,
  });
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm`);
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  const result = await txDb.transaction((tx) =>
    deleteEvent(tx, { id: e.id, actorId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshEventPages(slug, { themeWeek: true });
  redirect(`${LIST}?deleted=1`);
}
