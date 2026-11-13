import { dollarsToCents } from "@/domain/money/credit";
import { CARD_MINIMUM_CENTS } from "@/domain/registration/promo";
import { formatCents } from "@/domain/registration/pricing";
import { err, ok, type Result } from "@/domain/result";
import type { EventKind } from "./event";

/**
 * Paid event tickets (docs/product-spec.md, section 6, "Paid event tickets").
 * A ticketed event sells one ticket per person through Stripe Checkout. A
 * spot counts against the capacity while it is paid, or while it is held for
 * an open checkout or offered to the next person on the waitlist. Pure, so
 * the rules are tested without a database.
 */

/** The most a ticket can cost: $500. */
export const TICKET_MAX_CENTS = 50_000;

/** Checkout is open this long. Stripe's shortest allowed is 30 minutes. */
export const CHECKOUT_MINUTES = 31;

/**
 * A checkout's spot stays held this long after Stripe stops taking payment,
 * so a webhook that arrives late still finds it. The expired webhook frees
 * it sooner.
 */
export const HOLD_GRACE_MINUTES = 60;

/** How long the next person on the waitlist has to buy a spot that opened. */
export const OFFER_HOURS = 24;

export type TicketPrices = {
  ticketPriceCents: number | null;
  memberPriceCents: number | null;
};

export const FREE: TicketPrices = {
  ticketPriceCents: null,
  memberPriceCents: null,
};

/** What the admin form sends about the price, as strings. */
export type TicketPriceForm = { price: string; memberPrice: string };

export type TicketPriceError = "price" | "member_price";

export const TICKET_PRICE_ERRORS: Readonly<Record<TicketPriceError, string>> = {
  price: `A ticket costs from ${formatCents(CARD_MINIMUM_CENTS)} to ${formatCents(TICKET_MAX_CENTS)}, or leave it blank for a free event.`,
  member_price: `The member price is $0 (free for members), or from ${formatCents(CARD_MINIMUM_CENTS)} up to the ticket price. Leave it blank if members pay the same.`,
};

/**
 * Checks the price fields. Blank means a free event. A member price is
 * optional and never more than the ticket price; it may be $0, but not
 * between $0 and Stripe's card minimum, which no card could pay. A theme
 * week has nothing to attend, so it is always free.
 */
export function parseTicketPrices(
  form: TicketPriceForm,
  kind: EventKind,
): Result<TicketPrices, TicketPriceError> {
  if (kind === "theme_week") return ok(FREE);
  const price = form.price.trim();
  const member = form.memberPrice.trim();
  if (price === "") return member === "" ? ok(FREE) : err("member_price");
  const ticketPriceCents = dollarsToCents(price);
  if (
    ticketPriceCents === null ||
    ticketPriceCents < CARD_MINIMUM_CENTS ||
    ticketPriceCents > TICKET_MAX_CENTS
  )
    return err("price");
  if (member === "") return ok({ ticketPriceCents, memberPriceCents: null });
  const memberPriceCents = dollarsToCents(member);
  if (
    memberPriceCents === null ||
    memberPriceCents > ticketPriceCents ||
    (memberPriceCents > 0 && memberPriceCents < CARD_MINIMUM_CENTS)
  )
    return err("member_price");
  return ok({ ticketPriceCents, memberPriceCents });
}

/** Cents as the form shows them: "12" or "12.50"; blank for none. */
const asDollars = (cents: number | null) =>
  cents === null
    ? ""
    : cents % 100 === 0
      ? String(cents / 100)
      : (cents / 100).toFixed(2);

/** A stored event's prices as the form's values, for editing. */
export function ticketPriceFormValues(prices: TicketPrices): TicketPriceForm {
  return {
    price: asDollars(prices.ticketPriceCents),
    memberPrice: asDollars(prices.memberPriceCents),
  };
}

export const isTicketed = (prices: TicketPrices) =>
  prices.ticketPriceCents !== null;

/**
 * What this person pays, or null for a free event. Members (registered in
 * any season) get the member price when there is one.
 */
export function ticketPrice(
  prices: TicketPrices,
  member: boolean,
): number | null {
  if (prices.ticketPriceCents === null) return null;
  return member && prices.memberPriceCents !== null
    ? prices.memberPriceCents
    : prices.ticketPriceCents;
}

/** "$15", or "$15 ($10 for members)", or "Free for members, $15 otherwise". */
export function priceLine(prices: TicketPrices): string | null {
  const full = prices.ticketPriceCents;
  if (full === null) return null;
  const member = prices.memberPriceCents;
  if (member === null || member === full) return formatCents(full);
  if (member === 0) return `Free for members, ${formatCents(full)} otherwise`;
  return `${formatCents(full)} (${formatCents(member)} for members)`;
}

export type TicketStatus =
  "offered" | "held" | "paid" | "refunded" | "released" | "cancelled";

/** Whether a ticket's spot counts against the capacity now. */
export function holdsSpot(
  t: { status: TicketStatus; heldUntil: Date | null },
  now: Date,
): boolean {
  if (t.status === "paid") return true;
  if (t.status !== "offered" && t.status !== "held") return false;
  return t.heldUntil !== null && t.heldUntil > now;
}

/** When Stripe stops taking payment for a checkout started now. */
export function checkoutExpiry(now: Date): Date {
  return new Date(now.getTime() + CHECKOUT_MINUTES * 60_000);
}

/** How long a checkout started now holds its spot. */
export function holdUntil(now: Date): Date {
  return new Date(checkoutExpiry(now).getTime() + HOLD_GRACE_MINUTES * 60_000);
}

/**
 * How long an offer made now holds its spot: a day, but never past the
 * event's end.
 */
export function offerUntil(now: Date, endsAt: Date): Date {
  const day = now.getTime() + OFFER_HOURS * 3_600_000;
  return new Date(Math.min(day, endsAt.getTime()));
}

export type Spots = {
  capacity: number | null;
  /** People with a spot: going RSVPs, which include every paid ticket. */
  going: number;
  /** Spots held for an open checkout or offered to someone, not yet paid. */
  held: number;
  /** People on the waitlist without an offer. */
  waitlisted: number;
};

/** Spots nobody has or holds, or null when there is no limit. */
export function freeSpots(s: Spots): number | null {
  if (s.capacity === null) return null;
  return Math.max(0, s.capacity - s.going - s.held);
}

/**
 * Whether a new buyer can check out now or joins the waitlist. As with free
 * RSVPs, a newcomer waits behind anyone already in line.
 */
export function placeForBuyer(s: Spots): "checkout" | "waitlist" {
  const free = freeSpots(s);
  if (free === null) return "checkout";
  return free > 0 && s.waitlisted === 0 ? "checkout" : "waitlist";
}

/** How many people on the waitlist get an offer, given the spots now free. */
export function offersToMake(s: Spots): number {
  const free = freeSpots(s);
  return free === null ? s.waitlisted : Math.min(free, s.waitlisted);
}

/**
 * Check-in codes leave out 0, O, 1 and I, so a code read out at the door
 * can't be misheard or mistyped.
 */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/**
 * A check-in code from random bytes (one per character; 256 is a multiple
 * of the alphabet's 32 letters, so every letter is equally likely), skipping
 * any code the event already uses.
 */
export function checkInCode(
  randomBytes: (n: number) => Uint8Array,
  taken: ReadonlySet<string>,
): string {
  for (let tries = 0; tries < 100; tries++) {
    const bytes = randomBytes(CODE_LENGTH);
    const code = Array.from(
      bytes,
      (b) => CODE_ALPHABET[b % CODE_ALPHABET.length],
    ).join("");
    if (!taken.has(code)) return code;
  }
  throw new Error("No free check-in code");
}

/** "K7M4QX" as "K7M 4QX", easier to read out. */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** A code typed at the door, cleaned up, or null when it can't be one. */
export function normalizeCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code)
    ? code
    : null;
}
