import { err, ok, type Result } from "../result";
import { zonedInstant } from "../time/zoned";

/**
 * Promo codes (product-spec.md, "Promo codes"): an admin makes a code for a
 * season that takes a percentage or a fixed amount off what a person pays,
 * with an optional limit on how many times it is used and a last day.
 * Pure: the caller passes the code as stored, how often it has been used and
 * the time.
 */

export type PromoKind = "percent" | "amount";

export type PromoRule = {
  kind: PromoKind;
  /** Whole percent (1 to 100) for `percent`, cents for `amount`. */
  value: number;
};

export type StoredPromo = PromoRule & {
  code: string;
  maxRedemptions: number | null;
  validUntil: Date | null;
  /** Purchases already using it, paid or still at checkout. */
  redemptions: number;
};

/** Stripe will not take a card payment under 50 cents. */
export const CARD_MINIMUM_CENTS = 50;

const CODE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

/**
 * "  spring-10 " → "SPRING-10". Codes are matched without regard to case, so
 * they are stored upper case. Null when it cannot be a code.
 */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

export type PromoError = "unknown_code" | "expired" | "used_up";

/** Whether a code can be used now. */
export function checkPromo<P extends StoredPromo>(
  promo: P | null,
  now: Date,
): Result<P, PromoError> {
  if (!promo) return err("unknown_code");
  if (promo.validUntil && now > promo.validUntil) return err("expired");
  if (
    promo.maxRedemptions !== null &&
    promo.redemptions >= promo.maxRedemptions
  )
    return err("used_up");
  return ok(promo);
}

/**
 * What a code takes off a subtotal. A percentage rounds down to the cent, so
 * it never gives more than it says. The discount never exceeds the subtotal,
 * and it never leaves a total that is more than nothing but under the card
 * minimum: then the person pays the minimum instead.
 */
export function promoDiscount(subtotalCents: number, rule: PromoRule): number {
  if (subtotalCents <= 0) return 0;
  const raw =
    rule.kind === "percent"
      ? Math.floor((subtotalCents * rule.value) / 100)
      : rule.value;
  const discount = Math.min(Math.max(raw, 0), subtotalCents);
  const rest = subtotalCents - discount;
  if (rest > 0 && rest < CARD_MINIMUM_CENTS)
    return Math.max(0, subtotalCents - CARD_MINIMUM_CENTS);
  return discount;
}

/**
 * Spreads a discount over line items in proportion to their amounts, so
 * Stripe Checkout shows each item at the price actually charged. The
 * amounts it returns add up to the subtotal less the discount, and none is
 * below zero.
 */
export function spreadDiscount(
  amounts: readonly number[],
  discountCents: number,
): number[] {
  const subtotal = amounts.reduce((sum, a) => sum + a, 0);
  if (discountCents <= 0 || subtotal === 0) return [...amounts];
  const discount = Math.min(discountCents, subtotal);
  const shares = amounts.map((a) => Math.floor((a * discount) / subtotal));
  // Hand the cents lost to rounding to the largest items first.
  let left = discount - shares.reduce((sum, s) => sum + s, 0);
  const order = amounts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a - x.a || x.i - y.i);
  for (const { i } of order) {
    if (left === 0) break;
    const room = (amounts[i] ?? 0) - (shares[i] ?? 0);
    const take = Math.min(room, left);
    shares[i] = (shares[i] ?? 0) + take;
    left -= take;
  }
  return amounts.map((a, i) => a - (shares[i] ?? 0));
}

/** "10% off" or "$15 off". */
export function describePromo(
  rule: PromoRule,
  format: (cents: number) => string,
): string {
  return rule.kind === "percent"
    ? `${rule.value}% off`
    : `${format(rule.value)} off`;
}

export type PromoForm = {
  code: string;
  kind: string;
  value: string;
  maxRedemptions: string;
  validUntil: string;
};

export type NewPromo = PromoRule & {
  code: string;
  maxRedemptions: number | null;
  validUntil: Date | null;
};

export type PromoFormErrors = Partial<Record<keyof PromoForm, string>>;

const MONEY = /^\d{1,5}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks the new-code form. The amount is in dollars, the last day is a date
 * in the league's time zone and the code works until the end of it. The
 * rules mirror the table's checks, so the database never rejects what the
 * form accepted.
 */
export function parsePromoForm(
  form: PromoForm,
  timeZone: string,
): Result<NewPromo, PromoFormErrors> {
  const errors: PromoFormErrors = {};
  const code = normalizeCode(form.code);
  if (!code)
    errors.code = "Use 3 to 24 letters, numbers or dashes, such as SPRING10.";

  let rule: PromoRule | null = null;
  const value = form.value.trim().replace(/^\$/, "").replace(/%$/, "");
  if (form.kind === "percent") {
    const percent = /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
    if (percent >= 1 && percent <= 100)
      rule = { kind: "percent", value: percent };
    else errors.value = "Enter a whole percent from 1 to 100.";
  } else if (form.kind === "amount") {
    const [whole = "0", part = ""] = value.split(".");
    const cents = MONEY.test(value)
      ? Number(whole) * 100 + Number(part.padEnd(2, "0"))
      : Number.NaN;
    if (cents > 0) rule = { kind: "amount", value: cents };
    else errors.value = "Enter dollars, such as 15 or 7.50.";
  } else errors.kind = "Choose a percentage or an amount.";

  let maxRedemptions: number | null = null;
  const limit = form.maxRedemptions.trim();
  if (limit !== "") {
    const n = /^\d{1,5}$/.test(limit) ? Number(limit) : 0;
    if (n >= 1) maxRedemptions = n;
    else errors.maxRedemptions = "Enter how many times, or leave it blank.";
  }

  let validUntil: Date | null = null;
  const day = form.validUntil.trim();
  if (day !== "") {
    const valid =
      DATE.test(day) &&
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
    if (valid)
      validUntil = new Date(
        zonedInstant(day, "23:59", timeZone).getTime() + 59_999,
      );
    else errors.validUntil = "Pick a date, or leave it blank.";
  }

  if (!code || !rule || Object.keys(errors).length > 0) return err(errors);
  return ok({ code, ...rule, maxRedemptions, validUntil });
}
