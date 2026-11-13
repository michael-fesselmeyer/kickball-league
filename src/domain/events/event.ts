import { err, ok, type Result } from "@/domain/result";
import { localDay } from "@/domain/schedule/public-game";
import { slugify } from "@/domain/slug";
import { localTime, zonedInstant } from "@/domain/time/zoned";

/**
 * League events (docs/product-spec.md, "Community, events and content"):
 * what an admin types in, who gets a spot, and which game days a theme week
 * covers. Pure functions, so the rules are tested without a database.
 */

export const EVENT_KINDS = [
  "social",
  "party",
  "bar_night",
  "bbq",
  "tournament",
  "theme_week",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const KIND_LABELS: Readonly<Record<EventKind, string>> = {
  social: "Social",
  bar_night: "Bar night",
  bbq: "BBQ",
  tournament: "Tournament",
  theme_week: "Theme week",
  party: "Party",
};

export const MAX_TITLE_LENGTH = 80;
export const MAX_PLACE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_CAPACITY = 5000;
/** A theme week can run a little longer than a week, never a season. */
export const MAX_THEME_DAYS = 14;

/** What the admin form sends, as strings. */
export type EventForm = {
  kind: string;
  title: string;
  place: string;
  description: string;
  capacity: string;
  startsOn: string;
  startTime: string;
  endsOn: string;
  endTime: string;
};

/** A checked event, ready to save. */
export type EventInput = {
  kind: EventKind;
  title: string;
  place: string | null;
  description: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
};

export type EventFormError =
  | "kind"
  | "title"
  | "place"
  | "description"
  | "date"
  | "time"
  | "order"
  | "too_long"
  | "capacity";

export const EVENT_FORM_ERRORS: Readonly<Record<EventFormError, string>> = {
  kind: "Pick what kind of event this is.",
  title: `Give the event a name of up to ${MAX_TITLE_LENGTH} characters.`,
  place: `Say where it is, in up to ${MAX_PLACE_LENGTH} characters.`,
  description: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`,
  date: "Pick the date the event starts.",
  time: "Pick a start and end time.",
  order: "The event has to end after it starts.",
  too_long: `A theme week can run up to ${MAX_THEME_DAYS} days.`,
  capacity: `Capacity is a whole number from 1 to ${MAX_CAPACITY}, or blank for no limit.`,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isKind = (value: string): value is EventKind =>
  (EVENT_KINDS as readonly string[]).includes(value);

/** The day after a YYYY-MM-DD date. */
export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Days from one YYYY-MM-DD date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
}

/** A real calendar date: "2026-02-30" parses, but reads back as March 2. */
const validDate = (value: string) => {
  if (!DATE.test(value)) return false;
  const at = Date.parse(`${value}T12:00:00Z`);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value;
};

/**
 * Checks the admin form. Timed events take a start date and time and an end
 * time; an end time at or before the start time runs past midnight unless
 * an end date says otherwise. A theme week takes its first and last day.
 */
export function parseEventForm(
  form: EventForm,
  timeZone: string,
): Result<EventInput, EventFormError> {
  const kind = form.kind.trim();
  if (!isKind(kind)) return err("kind");
  const title = form.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH)
    return err("title");
  const place = form.place.trim();
  if (place.length > MAX_PLACE_LENGTH) return err("place");
  if (kind !== "theme_week" && place.length === 0) return err("place");
  const description = form.description.trim().replace(/\r\n/g, "\n");
  if (description.length > MAX_DESCRIPTION_LENGTH) return err("description");
  if (!validDate(form.startsOn)) return err("date");
  const endsOn = form.endsOn.trim();
  if (endsOn !== "" && !validDate(endsOn)) return err("date");

  let capacity: number | null = null;
  const rawCapacity = form.capacity.trim();
  if (kind !== "theme_week" && rawCapacity !== "") {
    if (!/^\d+$/.test(rawCapacity)) return err("capacity");
    capacity = Number(rawCapacity);
    if (capacity < 1 || capacity > MAX_CAPACITY) return err("capacity");
  }

  const common = {
    kind,
    title,
    place: place === "" ? null : place,
    description,
    capacity,
  };

  if (kind === "theme_week") {
    const last = endsOn === "" ? form.startsOn : endsOn;
    const days = daysBetween(form.startsOn, last) + 1;
    if (days < 1) return err("order");
    if (days > MAX_THEME_DAYS) return err("too_long");
    return ok({
      ...common,
      startsAt: zonedInstant(form.startsOn, "00:00", timeZone),
      endsAt: zonedInstant(nextDay(last), "00:00", timeZone),
    });
  }

  if (!TIME.test(form.startTime) || !TIME.test(form.endTime))
    return err("time");
  const startsAt = zonedInstant(form.startsOn, form.startTime, timeZone);
  const endDay =
    endsOn !== ""
      ? endsOn
      : form.endTime <= form.startTime
        ? nextDay(form.startsOn)
        : form.startsOn;
  const endsAt = zonedInstant(endDay, form.endTime, timeZone);
  if (endsAt <= startsAt) return err("order");
  return ok({ ...common, startsAt, endsAt });
}

type Timed = {
  kind: EventKind;
  title: string;
  place: string | null;
  description: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
};

/** A stored event as the admin form's values, for editing. */
export function eventFormValues(e: Timed, timeZone: string): EventForm {
  const startsOn = localDay(e.startsAt, timeZone);
  if (e.kind === "theme_week") {
    const { last } = themeWeekDays(e, timeZone);
    return {
      kind: e.kind,
      title: e.title,
      place: e.place ?? "",
      description: e.description,
      capacity: "",
      startsOn,
      startTime: "",
      endsOn: last,
      endTime: "",
    };
  }
  const startTime = localTime(e.startsAt, timeZone);
  const endTime = localTime(e.endsAt, timeZone);
  const endsOnDay = localDay(e.endsAt, timeZone);
  // Leave the end date blank when the form would work it out the same way.
  const implied = endTime <= startTime ? nextDay(startsOn) : startsOn;
  return {
    kind: e.kind,
    title: e.title,
    place: e.place ?? "",
    description: e.description,
    capacity: e.capacity === null ? "" : String(e.capacity),
    startsOn,
    startTime,
    endsOn: endsOnDay === implied ? "" : endsOnDay,
    endTime,
  };
}

/** The first and last day a theme week covers, in the league's time zone. */
export function themeWeekDays(
  e: { startsAt: Date; endsAt: Date },
  timeZone: string,
): { first: string; last: string } {
  return {
    first: localDay(e.startsAt, timeZone),
    // Ends at midnight after its last day: step back a minute to land on it.
    last: localDay(new Date(e.endsAt.getTime() - 60_000), timeZone),
  };
}

export type ThemeWeek = {
  title: string;
  slug: string;
  first: string;
  last: string;
};

/** The theme week a game day falls in, if any (the first one, if two overlap). */
export function themeFor(
  day: string,
  weeks: readonly ThemeWeek[],
): ThemeWeek | null {
  return weeks.find((w) => w.first <= day && day <= w.last) ?? null;
}

export type RsvpStatus = "going" | "waitlisted";

/** Whether a new RSVP gets a spot or joins the waitlist. */
export function placeFor(
  capacity: number | null,
  going: number,
  waitlisted: number,
): RsvpStatus {
  if (capacity === null) return "going";
  // Someone already waiting keeps their place in line.
  return going < capacity && waitlisted === 0 ? "going" : "waitlisted";
}

/** How many waitlisted people move up, given the spots now free. */
export function promotions(
  capacity: number | null,
  going: number,
  waitlisted: number,
): number {
  if (capacity === null) return waitlisted;
  return Math.max(0, Math.min(capacity - going, waitlisted));
}

/** Spots still open, or null when there is no limit. */
export function spotsLeft(capacity: number | null, going: number) {
  return capacity === null ? null : Math.max(0, capacity - going);
}

export type RsvpWindow =
  "open" | "cancelled" | "over" | "no_rsvp" | "invite_only";

/**
 * Whether people can RSVP now. Changes are taken until the event ends, so
 * someone can still drop out (and free a spot) after it starts. An event
 * whose admin turned in-app RSVPs off takes them only on its invite link.
 */
export function rsvpWindow(
  e: {
    kind: EventKind;
    endsAt: Date;
    cancelledAt: Date | null;
    inAppRsvp: boolean;
  },
  now: Date,
): RsvpWindow {
  if (e.kind === "theme_week") return "no_rsvp";
  if (e.cancelledAt) return "cancelled";
  if (e.endsAt <= now) return "over";
  return e.inAppRsvp ? "open" : "invite_only";
}

/**
 * "Fri, Nov 20, 7:00 – 10:00 PM", "Sat, Nov 21, 10:00 PM – Sun, Nov 22,
 * 1:00 AM", or for a theme week "Mon, Oct 26 – Sun, Nov 1".
 */
export function whenLine(
  e: { kind: EventKind; startsAt: Date; endsAt: Date },
  timeZone: string,
): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (e.kind === "theme_week") {
    const { first, last } = themeWeekDays(e, timeZone);
    const asDay = (d: string) => day.format(zonedInstant(d, "12:00", timeZone));
    return first === last ? asDay(first) : `${asDay(first)} – ${asDay(last)}`;
  }
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay =
    localDay(e.startsAt, timeZone) === localDay(e.endsAt, timeZone) ||
    // Past midnight but before morning reads as the same night.
    e.endsAt.getTime() - e.startsAt.getTime() <= 12 * 3_600_000;
  return sameDay
    ? `${day.format(e.startsAt)}, ${time.format(e.startsAt)} – ${time.format(e.endsAt)}`
    : `${day.format(e.startsAt)}, ${time.format(e.startsAt)} – ${day.format(e.endsAt)}, ${time.format(e.endsAt)}`;
}

/** The slug for a new event: its title and start date, so repeats differ. */
export function eventSlug(
  title: string,
  startsAt: Date,
  timeZone: string,
): string {
  const base = slugify(title).slice(0, 60).replace(/-+$/, "") || "event";
  return `${base}-${localDay(startsAt, timeZone)}`;
}
