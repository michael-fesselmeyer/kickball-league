import type { AudienceKind } from "@/domain/events/audience";
import { type EventKind, KIND_LABELS } from "@/domain/events/event";
import { buildCalendar, type CalendarEvent } from "./ics";

/** What the feed needs to know about an event. */
export type FeedEvent = {
  id: string;
  slug: string;
  kind: EventKind;
  title: string;
  place: string | null;
  description: string;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
  audience: { kind: AudienceKind };
  inviteUrl: string | null;
};

/**
 * One league event as a calendar entry; a theme week covers whole days. A
 * members' or team event links to its page in the app, since it has no
 * public page.
 */
export function leagueEvent(e: FeedEvent, origin: string): CalendarEvent {
  const url =
    e.audience.kind === "public"
      ? `${origin}/events/${e.slug}`
      : `${origin}/app/events/${e.slug}`;
  const cancelled = e.cancelledAt !== null;
  const entry: CalendarEvent = {
    uid: `event-${e.id}@kickball-league`,
    start: e.startsAt,
    end: e.endsAt,
    summary:
      (cancelled ? "Called off: " : "") +
      (e.kind === "theme_week" ? `${KIND_LABELS.theme_week}: ` : "") +
      e.title,
    description: [
      e.description,
      e.inviteUrl ? `Invite: ${e.inviteUrl}` : "",
      `Event page: ${url}`,
    ]
      .filter((line) => line !== "")
      .join("\n\n"),
    url,
    status: cancelled ? "CANCELLED" : "CONFIRMED",
  };
  if (e.place) entry.location = e.place;
  if (e.kind === "theme_week") entry.allDay = true;
  return entry;
}

/** The league's events calendar, to subscribe to or to save one event from. */
export function eventsFeed({
  name,
  timeZone,
  origin,
  events,
  now,
}: {
  name: string;
  timeZone: string;
  origin: string;
  events: readonly FeedEvent[];
  now: Date;
}): string {
  return buildCalendar({
    name,
    description:
      "League events: bar nights, BBQs, tournaments and theme weeks. Updates when the league adds or changes one.",
    timeZone,
    generatedAt: now,
    refreshMinutes: 360,
    events: events.map((e) => leagueEvent(e, origin)),
  });
}
