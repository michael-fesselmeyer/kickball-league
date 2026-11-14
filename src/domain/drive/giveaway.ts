import { randomInt as cryptoRandomInt } from "node:crypto";
import { type Audience, canSee, type Viewer } from "@/domain/events/audience";
import { err, ok, type Result } from "@/domain/result";
import { localDay } from "@/domain/schedule/public-game";
import { localTime, zonedInstant } from "@/domain/time/zoned";
import {
  MAX_DONOR_LENGTH,
  MAX_PRIZE_LENGTH,
  MAX_REASON_LENGTH,
  MAX_RULES_LENGTH,
  MAX_WINNERS,
  MIN_REASON_LENGTH,
  MIN_RULES_LENGTH,
} from "./giveaway-limits";

/**
 * A free giveaway at a league event (ADR 0035). Entry is free and needs
 * only an account: a player enters by scanning the giveaway's rotating
 * code at the event, once. Nothing about entering may depend on a payment,
 * a ticket or a registration fee; in New York a raffle people pay to enter
 * is gambling that only licensed nonprofits may run, while a free giveaway
 * with published rules is fine. Pure: no clock and no database.
 */

export {
  MAX_DONOR_LENGTH,
  MAX_PRIZE_LENGTH,
  MAX_REASON_LENGTH,
  MAX_RULES_LENGTH,
  MAX_WINNERS,
  MIN_REASON_LENGTH,
  MIN_RULES_LENGTH,
};

/** Shown on every giveaway page and in the default rules. */
export const NO_PURCHASE_LINE =
  "No purchase necessary. Entry is free and never depends on a ticket, a payment or a registration fee.";

/**
 * How winners are drawn, as the audit log records it. No seed is kept:
 * each pick comes from the operating system's secure random source, so no
 * one can rerun or steer the draw.
 */
export const DRAW_METHOD =
  "crypto.randomInt partial Fisher-Yates shuffle over entries ordered by entry time, no seed";

/**
 * Whether an event can hold a giveaway. Entry means being at the event, so
 * an event that sells tickets can't: entering would cost money. A theme
 * week has no one place to check in.
 */
export function eventCanHoldGiveaway(e: {
  kind: string;
  ticketed: boolean;
}): Result<true, "ticketed" | "theme_week"> {
  if (e.ticketed) return err("ticketed");
  if (e.kind === "theme_week") return err("theme_week");
  return ok(true);
}

export const HOLD_ERRORS: Readonly<Record<"ticketed" | "theme_week", string>> =
  {
    ticketed:
      "This event sells tickets, so it can't hold a giveaway: entry has to be free, and being there would cost money. Make the event free first.",
    theme_week:
      "A theme week has no one place to check in, so it can't hold a giveaway. Add it to a bar night or party instead.",
  };

/** Where a giveaway stands at an instant. */
export type GiveawayPhase = "not_open" | "open" | "closed" | "drawn";

export type GiveawayTimes = {
  opensAt: Date;
  closesAt: Date;
  drawnAt: Date | null;
};

export function giveawayPhase(g: GiveawayTimes, now: Date): GiveawayPhase {
  if (g.drawnAt !== null) return "drawn";
  if (now < g.opensAt) return "not_open";
  if (now >= g.closesAt) return "closed";
  return "open";
}

export type EntryRefusal =
  | "not_for_you"
  | "event_off"
  | "ticketed"
  | "not_open"
  | "closed"
  | "already_entered";

export const ENTRY_REFUSALS: Readonly<Record<EntryRefusal, string>> = {
  not_for_you: "This giveaway is for the people the event is for.",
  event_off: "The league called this event off, so its giveaway is closed.",
  ticketed:
    "This event sells tickets, so it can't run a giveaway: entry would depend on buying one.",
  not_open: "Entry hasn't opened yet. Scan the code again once it does.",
  closed: "Entry has closed for this giveaway.",
  already_entered: "You're already entered. One entry per person.",
};

/**
 * Whether a signed-in person may enter now. The event's audience decides
 * who: anyone with an account for a public event, otherwise the members or
 * teams it is for. Admins see every event but enter only one that is for
 * them. Entry never asks about payments or tickets.
 */
export function mayEnter(input: {
  audience: Audience;
  viewer: NonNullable<Viewer>;
  giveaway: GiveawayTimes;
  eventCancelled: boolean;
  /** The event sells tickets: being there would cost money. */
  eventTicketed: boolean;
  alreadyEntered: boolean;
  now: Date;
}): Result<true, EntryRefusal> {
  const asPlayer = { ...input.viewer, staff: false };
  if (!canSee(input.audience, asPlayer)) return err("not_for_you");
  if (input.eventCancelled) return err("event_off");
  if (input.eventTicketed) return err("ticketed");
  if (input.alreadyEntered) return err("already_entered");
  const phase = giveawayPhase(input.giveaway, input.now);
  if (phase === "not_open") return err("not_open");
  if (phase !== "open") return err("closed");
  return ok(true);
}

/** A source of uniform integers in [0, max), like crypto.randomInt. */
export type RandomInt = (max: number) => number;

const secureRandomInt: RandomInt = (max) => cryptoRandomInt(max);

/**
 * Draws `count` distinct winners from `entries` (or all of them when there
 * are fewer). A partial Fisher-Yates shuffle: step i swaps position i with
 * a uniformly chosen position from i to the end, so every ordered list of
 * winners is equally likely. `indexes` are the drawn positions in the
 * original order, for the audit record.
 */
export function drawWinners<T>(
  entries: readonly T[],
  count: number,
  randomInt: RandomInt = secureRandomInt,
): { winners: T[]; indexes: number[] } {
  const positions = entries.map((_, i) => i);
  const take = Math.max(0, Math.min(count, entries.length));
  const indexes: number[] = [];
  for (let i = 0; i < take; i++) {
    const span = positions.length - i;
    const j = i + randomInt(span);
    const picked = positions[j];
    const here = positions[i];
    if (picked === undefined || here === undefined)
      throw new Error("drawWinners: random value out of range");
    positions[i] = picked;
    positions[j] = here;
    indexes.push(picked);
  }
  const winners: T[] = [];
  for (const i of indexes) {
    const entry = entries[i];
    if (entry !== undefined) winners.push(entry);
  }
  return { winners, indexes };
}

/** What the admin form sends, as strings. */
export type GiveawayForm = {
  prize: string;
  donatedBy: string;
  winnerCount: string;
  opensOn: string;
  opensTime: string;
  closesOn: string;
  closesTime: string;
  officialRules: string;
};

export type GiveawayInput = {
  prize: string;
  donatedBy: string | null;
  winnerCount: number;
  opensAt: Date;
  closesAt: Date;
  officialRules: string;
};

export type GiveawayFormError =
  "prize" | "donor" | "winners" | "date" | "order" | "rules" | "purchase";

export const GIVEAWAY_FORM_ERRORS: Readonly<Record<GiveawayFormError, string>> =
  {
    prize: `Describe the prize in up to ${MAX_PRIZE_LENGTH} characters.`,
    donor: `Keep the donor's name under ${MAX_DONOR_LENGTH} characters, or leave it blank.`,
    winners: `Pick from 1 to ${MAX_WINNERS} winners.`,
    date: "Pick when entry opens and closes.",
    order: "Entry has to close after it opens.",
    rules: `Write the official rules, from ${MIN_RULES_LENGTH} to ${MAX_RULES_LENGTH} characters.`,
    purchase:
      "The official rules must say no purchase is necessary. Entry to a league giveaway is always free.",
  };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const validDate = (value: string) => {
  if (!DATE.test(value)) return false;
  const at = Date.parse(`${value}T12:00:00Z`);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value;
};

/** Checks the admin form; times are wall-clock times in the league's zone. */
export function parseGiveawayForm(
  form: GiveawayForm,
  timeZone: string,
): Result<GiveawayInput, GiveawayFormError> {
  const prize = form.prize.trim();
  if (prize.length === 0 || prize.length > MAX_PRIZE_LENGTH)
    return err("prize");
  const donor = form.donatedBy.trim();
  if (donor.length > MAX_DONOR_LENGTH) return err("donor");
  const count = form.winnerCount.trim();
  if (!/^\d{1,2}$/.test(count)) return err("winners");
  const winnerCount = Number(count);
  if (winnerCount < 1 || winnerCount > MAX_WINNERS) return err("winners");
  if (
    !validDate(form.opensOn) ||
    !validDate(form.closesOn) ||
    !TIME.test(form.opensTime) ||
    !TIME.test(form.closesTime)
  )
    return err("date");
  const opensAt = zonedInstant(form.opensOn, form.opensTime, timeZone);
  const closesAt = zonedInstant(form.closesOn, form.closesTime, timeZone);
  if (closesAt <= opensAt) return err("order");
  const officialRules = form.officialRules.trim().replace(/\r\n/g, "\n");
  if (
    officialRules.length < MIN_RULES_LENGTH ||
    officialRules.length > MAX_RULES_LENGTH
  )
    return err("rules");
  if (!/no purchase (is )?necessary/i.test(officialRules))
    return err("purchase");
  return ok({
    prize,
    donatedBy: donor === "" ? null : donor,
    winnerCount,
    opensAt,
    closesAt,
    officialRules,
  });
}

/** A stored giveaway as the form's values, for editing. */
export function giveawayFormValues(
  g: GiveawayInput,
  timeZone: string,
): GiveawayForm {
  return {
    prize: g.prize,
    donatedBy: g.donatedBy ?? "",
    winnerCount: String(g.winnerCount),
    opensOn: localDay(g.opensAt, timeZone),
    opensTime: localTime(g.opensAt, timeZone),
    closesOn: localDay(g.closesAt, timeZone),
    closesTime: localTime(g.closesAt, timeZone),
    officialRules: g.officialRules,
  };
}

/**
 * A new giveaway's form: entry open for the event's run, one winner, and
 * plain rules the admin edits. The rules start with the no-purchase line.
 */
export function blankGiveawayForm(
  e: { title: string; startsAt: Date; endsAt: Date },
  timeZone: string,
): GiveawayForm {
  return {
    prize: "",
    donatedBy: "",
    winnerCount: "1",
    opensOn: localDay(e.startsAt, timeZone),
    opensTime: localTime(e.startsAt, timeZone),
    closesOn: localDay(e.endsAt, timeZone),
    closesTime: localTime(e.endsAt, timeZone),
    officialRules: [
      NO_PURCHASE_LINE,
      `How to enter: check in at ${e.title} by scanning the giveaway code there, while entry is open. One entry per person. You need a free league account.`,
      "Who can enter: anyone the event is for.",
      "How winners are picked: at random in the league app, from every entry, after entry closes. Winners are told in the app and by email, and have 14 days to claim the prize before another winner is drawn.",
      "The prize can't be exchanged for cash.",
    ].join("\n\n"),
  };
}

/** Checks the reason an admin gives for redrawing a winner. */
export function parseRedrawReason(raw: string): Result<string, "reason"> {
  const reason = raw.trim().replace(/\s+/g, " ");
  return reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH
    ? err("reason")
    : ok(reason);
}

export const REDRAW_REASON_ERROR = `Say why this winner is being replaced, in ${MIN_REASON_LENGTH} to ${MAX_REASON_LENGTH} characters.`;
