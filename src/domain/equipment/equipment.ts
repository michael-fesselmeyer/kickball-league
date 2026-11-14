import { kickoff, shortDay } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import { err, ok, type Result } from "@/domain/result";

/**
 * The league's gear (issue #286): kits of ball bags, bases, pumps, cones
 * and the first-aid kit. A kit lives at its home location between game
 * days; an admin assigns it to a person for a game; that person picks it up
 * from home or from whoever had it last and brings it to the field before
 * kickoff. Handoffs need the receiver's confirmation, so the kit's holder
 * is always someone who said they have it. Pure rules; the database work
 * is in src/db/queries/equipment.ts.
 */

/** The kit is at the field this long before the game's kickoff. */
export const KIT_LEAD_MINUTES = 30;

export const KIT_NAME_MAX = 40;
export const KIT_HOME_MAX = 120;
export const KIT_ITEM_MAX = 60;
export const KIT_ITEMS_MAX = 20;
export const REPORT_NOTE_MAX = 500;

/** When the person bringing a kit should have it at the field. */
export function bringBy(startsAt: Date): Date {
  return new Date(startsAt.getTime() - KIT_LEAD_MINUTES * 60_000);
}

/** "McCarren Park, Field 2": where a kit goes. */
export function placeName(venue: string, field: string): string {
  return `${venue}, ${field}`;
}

export type KitInput = {
  name: string;
  contents: string[];
  homeLocation: string;
};

export type KitFormError =
  | "name_missing"
  | "name_too_long"
  | "contents_missing"
  | "too_many_items"
  | "item_too_long"
  | "home_missing"
  | "home_too_long";

const clean = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/**
 * A kit from the admin's form: a name, its contents one item per line, and
 * its home location. Blank lines and repeated items are dropped.
 */
export function parseKitForm(form: {
  name: unknown;
  contents: unknown;
  homeLocation: unknown;
}): Result<KitInput, KitFormError> {
  const name = clean(form.name);
  if (!name) return err("name_missing");
  if (name.length > KIT_NAME_MAX) return err("name_too_long");
  const lines =
    typeof form.contents === "string" ? form.contents.split(/\r?\n/) : [];
  const contents: string[] = [];
  for (const line of lines) {
    const item = clean(line);
    if (!item) continue;
    if (item.length > KIT_ITEM_MAX) return err("item_too_long");
    if (!contents.some((c) => c.toLowerCase() === item.toLowerCase()))
      contents.push(item);
  }
  if (contents.length === 0) return err("contents_missing");
  if (contents.length > KIT_ITEMS_MAX) return err("too_many_items");
  const homeLocation = clean(form.homeLocation);
  if (!homeLocation) return err("home_missing");
  if (homeLocation.length > KIT_HOME_MAX) return err("home_too_long");
  return ok({ name, contents, homeLocation });
}

export type MissingReport = { missing: string[]; note: string | null };
export type MissingFormError = "nothing" | "unknown_item" | "note_too_long";

/**
 * A missing-items report: items picked from the kit's own contents, and an
 * optional note. It must say something: an item or a note.
 */
export function parseMissingForm(
  contents: readonly string[],
  picked: readonly unknown[],
  note: unknown,
): Result<MissingReport, MissingFormError> {
  const missing: string[] = [];
  for (const item of picked) {
    if (typeof item !== "string" || !contents.includes(item))
      return err("unknown_item");
    if (!missing.includes(item)) missing.push(item);
  }
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > REPORT_NOTE_MAX) return err("note_too_long");
  if (missing.length === 0 && !text) return err("nothing");
  // Kept in the kit's own order, whatever order the form sent.
  missing.sort((a, b) => contents.indexOf(a) - contents.indexOf(b));
  return ok({ missing, note: text || null });
}

/** Where a kit is right now, as the kit's state knows it. */
export type KitState<U extends string = string> = {
  holderId: U | null;
  retired: boolean;
  /** A handoff waiting for its receiver's answer. */
  pending: { fromUserId: U | null; toUserId: U | null } | null;
};

/** In plain words, for admins: "With Jo S.", "On its way to Sam R.". */
export function whereabouts(kit: {
  holderName: string | null;
  holderId: string | null;
  homeLocation: string;
  pendingToName: string | null;
}): string {
  if (kit.pendingToName)
    return kit.holderId
      ? `${kit.holderName ?? "Someone"} is handing it to ${kit.pendingToName}`
      : `On its way to ${kit.pendingToName}`;
  if (kit.holderId) return `With ${kit.holderName ?? "a former member"}`;
  return `At home: ${kit.homeLocation}`;
}

export type HandOffError =
  "retired" | "not_holder" | "pending" | "no_receiver" | "self";

/**
 * "I handed Kit A to Sam": only the person holding the kit, while no other
 * handoff waits, and never to themselves.
 */
export function checkHandOff<U extends string>(
  kit: KitState<U>,
  actor: U,
  to: U | null,
): Result<U, HandOffError> {
  if (kit.retired) return err("retired");
  if (kit.holderId !== actor) return err("not_holder");
  if (kit.pending) return err("pending");
  if (to === null) return err("no_receiver");
  if (to === actor) return err("self");
  return ok(to);
}

export type AnswerError = "not_pending" | "not_receiver" | "not_giver";

/** The receiver confirms or says they don't have it. */
export function checkAnswer<U extends string>(
  handoff: { status: string; toUserId: U | null },
  actor: U,
): Result<null, AnswerError> {
  if (handoff.status !== "pending") return err("not_pending");
  if (handoff.toUserId !== actor) return err("not_receiver");
  return ok(null);
}

/** The giver takes a handoff back before it is answered. */
export function checkCancel<U extends string>(
  handoff: { status: string; fromUserId: U | null },
  actor: U,
): Result<null, AnswerError> {
  if (handoff.status !== "pending") return err("not_pending");
  if (handoff.fromUserId !== actor) return err("not_giver");
  return ok(null);
}

export type PickUpError = "retired" | "not_home" | "pending" | "not_assigned";

/**
 * "I picked it up from home": the kit is at home, nothing waits, and the
 * person is bringing it to a game that hasn't ended.
 */
export function checkPickUp<U extends string>(
  kit: KitState<U>,
  assigned: boolean,
): Result<null, PickUpError> {
  if (kit.retired) return err("retired");
  if (kit.holderId !== null) return err("not_home");
  if (kit.pending) return err("pending");
  if (!assigned) return err("not_assigned");
  return ok(null);
}

export type ReturnError = "retired" | "not_holder" | "pending";

/** "It's back home": only its holder, while no handoff waits. */
export function checkReturnHome<U extends string>(
  kit: KitState<U>,
  actor: U,
): Result<null, ReturnError> {
  if (kit.retired) return err("retired");
  if (kit.holderId !== actor) return err("not_holder");
  if (kit.pending) return err("pending");
  return ok(null);
}

/**
 * Who may report missing items: whoever holds the kit, is being handed it
 * or is bringing it to a game that hasn't ended, and admins.
 */
export function mayReport<U extends string>(
  kit: KitState<U>,
  actor: U,
  { assigned, admin }: { assigned: boolean; admin: boolean },
): boolean {
  return (
    admin ||
    assigned ||
    kit.holderId === actor ||
    kit.pending?.toUserId === actor
  );
}

export type Assignment<U extends string = string> = {
  userId: U;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Who the holder hands the kit to: the person bringing it to its next game
 * that hasn't ended, skipping the holder's own games. Null when nobody
 * else needs it; the holder returns it home instead.
 */
export function nextReceiver<U extends string, A extends Assignment<U>>(
  assignments: readonly A[],
  holderId: NoInfer<U> | null,
  now: Date,
): A | null {
  return (
    [...assignments]
      .filter((a) => a.endsAt > now && a.userId !== holderId)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null
  );
}

/** Whether the person has an assignment for a game that hasn't ended. */
export const assignedNow = <U extends string>(
  assignments: readonly Assignment<U>[],
  userId: NoInfer<U>,
  now: Date,
): boolean => assignments.some((a) => a.userId === userId && a.endsAt > now);

/** The evening reminder goes out the day before the game, league time. */
export function remindsTonight(
  startsAt: Date,
  now: Date,
  timeZone: string,
): boolean {
  const tomorrow = new Date(`${localDay(now, timeZone)}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return localDay(startsAt, timeZone) === tomorrow.toISOString().slice(0, 10);
}

/** "today", "tomorrow" or "Tue, Nov 17", for the kit's game day. */
export function dayWords(startsAt: Date, now: Date, timeZone: string): string {
  const day = localDay(startsAt, timeZone);
  if (day === localDay(now, timeZone)) return "today";
  if (remindsTonight(startsAt, now, timeZone)) return "tomorrow";
  return shortDay(startsAt, timeZone);
}

/**
 * The line the person bringing a kit sees by their game: "You have Kit A:
 * bring it to McCarren Park, Field 2 by 6:30 PM", and how to get it first
 * when they don't have it yet.
 */
export function kitLine(input: {
  kitName: string;
  place: string;
  startsAt: Date;
  timeZone: string;
  now: Date;
  /** What the person knows about the kit right now. */
  status:
    | { kind: "holding" }
    | { kind: "at_home"; homeLocation: string }
    | { kind: "with"; name: string }
    | { kind: "on_its_way" };
}): string {
  const by = kickoff(bringBy(input.startsAt), input.timeZone);
  const day = dayWords(input.startsAt, input.now, input.timeZone);
  const bring = `bring it to ${input.place} by ${by}`;
  const bringOn = day === "today" ? bring : `${bring} ${onDay(day)}`;
  switch (input.status.kind) {
    case "holding":
      return `You have ${input.kitName}: ${bringOn}`;
    case "on_its_way":
      return `${input.kitName} is on its way to you: ${bringOn}`;
    case "at_home":
      return `${input.kitName} is yours ${onDay(day)}: pick it up from ${input.status.homeLocation}, then ${bring}`;
    case "with":
      return `${input.kitName} is yours ${onDay(day)}: get it from ${input.status.name}, then ${bring}`;
  }
}

const onDay = (day: string) =>
  day === "today" || day === "tomorrow" ? day : `on ${day}`;

/** Messages for the refusals people can run into, by error. */
export const GEAR_ERRORS: Record<string, string> = {
  retired: "That kit is no longer in use.",
  not_holder: "You don't have that kit right now.",
  pending: "A handoff for that kit is already waiting for an answer.",
  no_receiver: "Nobody else is bringing that kit to a game yet.",
  self: "You already have it.",
  not_pending: "That handoff was already answered.",
  not_receiver: "That handoff isn't for you.",
  not_giver: "Only the person who handed it on can take it back.",
  not_home: "Someone has that kit right now; get it from them.",
  not_assigned: "You aren't bringing that kit to a game.",
  not_found: "That kit wasn't found.",
  nothing: "Pick what's missing, or add a note.",
  unknown_item: "Pick items from the kit's list.",
  note_too_long: `Keep the note under ${REPORT_NOTE_MAX} characters.`,
  not_allowed: "Only the person with the kit, or bringing it, can report it.",
};
