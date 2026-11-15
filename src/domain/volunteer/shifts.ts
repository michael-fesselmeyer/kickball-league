import { isIsoDate } from "@/domain/availability/away";
import { err, ok, type Result } from "@/domain/result";
import { localDay } from "@/domain/schedule/public-game";
import { localTime, zonedInstant } from "@/domain/time/zoned";
import {
  MAX_NOTES_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_SPOTS,
  VOLUNTEER_ROLES,
  type VolunteerRole,
} from "./limits";

/**
 * Volunteer shifts: an admin posts a job on a game day or at an event with
 * a number of spots, and members claim and drop spots. Pure: no clock and
 * no database. The spot count is enforced again under a row lock in
 * src/db/queries/volunteer.ts, so two people can't both take the last spot.
 */

export {
  MAX_NOTES_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_SPOTS,
  ROLE_LABELS,
  VOLUNTEER_ROLES,
  type VolunteerRole,
} from "./limits";

/** What each job asks of a volunteer, shown under its label. */
export const ROLE_HINTS: Readonly<Record<VolunteerRole, string>> = {
  setup: "Bases, cones and the equipment bag out before the first game.",
  teardown:
    "Everything packed up and the field left clean after the last game.",
  check_in: "Greet players and tick them off as they arrive.",
  ref_fill_in: "Step in as ref when an assigned ref can't make it.",
  setup_lead:
    "Run set-up: inside the permitted area, park users asked to move before play, and the field left clean.",
};

/** A game day in a season, or an event. */
export type Occasion =
  { kind: "season"; seasonId: string } | { kind: "event"; eventId: string };

export type ShiftInput = {
  role: VolunteerRole;
  occasion: Occasion;
  startsAt: Date;
  endsAt: Date;
  place: string | null;
  notes: string;
  spots: number;
};

export type ShiftForm = {
  role: string;
  occasion: string;
  on: string;
  starts: string;
  ends: string;
  place: string;
  notes: string;
  spots: string;
};

export type ShiftFormError =
  "role" | "occasion" | "date" | "time" | "order" | "spots" | "place" | "notes";

export const SHIFT_FORM_ERRORS: Readonly<Record<ShiftFormError, string>> = {
  role: "Choose what the shift is for.",
  occasion: "Choose the game day's season or the event.",
  date: "Enter the shift's date.",
  time: "Enter a start and end time.",
  order: "The shift has to end after it starts.",
  spots: `A shift has between 1 and ${MAX_SPOTS} spots.`,
  place: `Keep the place under ${MAX_PLACE_LENGTH} characters.`,
  notes: `Keep the notes under ${MAX_NOTES_LENGTH} characters.`,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRole = (value: string): value is VolunteerRole =>
  (VOLUNTEER_ROLES as readonly string[]).includes(value);

/** The occasion picker's value: `season:<id>` or `event:<id>`. */
export function occasionValue(o: Occasion): string {
  return o.kind === "season" ? `season:${o.seasonId}` : `event:${o.eventId}`;
}

export function parseOccasion(value: string): Occasion | null {
  const [kind, id = ""] = value.split(":");
  if (!UUID.test(id)) return null;
  if (kind === "season") return { kind, seasonId: id.toLowerCase() };
  if (kind === "event") return { kind, eventId: id.toLowerCase() };
  return null;
}

/**
 * The admin's shift form, read in the league's time zone. A shift that
 * ends at or before its start time is taken to run past midnight only when
 * it ends before 06:00 (a late teardown); otherwise it's a mistake.
 */
export function parseShiftForm(
  form: ShiftForm,
  timeZone: string,
): Result<ShiftInput, ShiftFormError> {
  if (!isRole(form.role)) return err("role");
  const occasion = parseOccasion(form.occasion);
  if (!occasion) return err("occasion");
  if (!isIsoDate(form.on)) return err("date");
  if (!TIME.test(form.starts) || !TIME.test(form.ends)) return err("time");
  const startsAt = zonedInstant(form.on, form.starts, timeZone);
  let endsAt = zonedInstant(form.on, form.ends, timeZone);
  if (endsAt <= startsAt && form.ends < "06:00")
    endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);
  if (endsAt <= startsAt) return err("order");
  const spots = Number(form.spots.trim());
  if (!Number.isInteger(spots) || spots < 1 || spots > MAX_SPOTS)
    return err("spots");
  const place = form.place.trim();
  if (place.length > MAX_PLACE_LENGTH) return err("place");
  const notes = form.notes.trim();
  if (notes.length > MAX_NOTES_LENGTH) return err("notes");
  return ok({
    role: form.role,
    occasion,
    startsAt,
    endsAt,
    place: place === "" ? null : place,
    notes,
    spots,
  });
}

/** A saved shift as its form shows it, for editing. */
export function shiftFormValues(s: ShiftInput, timeZone: string): ShiftForm {
  return {
    role: s.role,
    occasion: occasionValue(s.occasion),
    on: localDay(s.startsAt, timeZone),
    starts: localTime(s.startsAt, timeZone),
    ends: localTime(s.endsAt, timeZone),
    place: s.place ?? "",
    notes: s.notes,
    spots: String(s.spots),
  };
}

export type ClaimRefusal = "started" | "full" | "already";

export const CLAIM_REFUSALS: Readonly<Record<ClaimRefusal, string>> = {
  started: "That shift has already started.",
  full: "That shift is full. Thanks for offering!",
  already: "You're already on that shift.",
};

/** Whether a member may take a spot: not started, not theirs, not full. */
export function mayClaim(input: {
  startsAt: Date;
  spots: number;
  taken: number;
  alreadyOn: boolean;
  now: Date;
}): Result<void, ClaimRefusal> {
  if (input.now >= input.startsAt) return err("started");
  if (input.alreadyOn) return err("already");
  if (input.taken >= input.spots) return err("full");
  return ok(undefined);
}

/** Whether a member may give their spot back: only before it starts. */
export function mayDrop(input: {
  startsAt: Date;
  now: Date;
}): Result<void, "started"> {
  return input.now >= input.startsAt ? err("started") : ok(undefined);
}

/** Spots still open, never below zero (an admin may cut the spots). */
export function spotsLeft(spots: number, taken: number): number {
  return Math.max(0, spots - taken);
}

/**
 * The spots line on a shift card: "2 of 4 spots left", "Full".
 */
export function spotsLine(spots: number, taken: number): string {
  const left = spotsLeft(spots, taken);
  if (left === 0) return "Full";
  return `${left} of ${spots} ${spots === 1 ? "spot" : "spots"} left`;
}
