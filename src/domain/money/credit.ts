import { CARD_MINIMUM_CENTS } from "../registration/promo";
import { err, ok, type Result } from "../result";

/**
 * League credit (product-spec.md, "League credit ledger"). Pure: the caller
 * passes the person's balance and what they owe.
 */

export type CreditReason =
  "rainout_rebate" | "referral" | "goodwill" | "spent" | "released";

/** What a referrer gets when the friend they brought pays for a season. */
export const REFERRAL_CREDIT_CENTS = 1000;

/** The most an admin can give as goodwill in one go. */
export const GOODWILL_MAX_CENTS = 50_000;

/**
 * How much credit to use on a checkout. It never exceeds the balance or the
 * total, and it never leaves a charge that is more than nothing but under
 * Stripe's card minimum: then a little less credit is used, so the card
 * pays the minimum and the rest stays in the balance.
 */
export function creditToApply(
  totalCents: number,
  balanceCents: number,
): number {
  if (totalCents <= 0 || balanceCents <= 0) return 0;
  const credit = Math.min(totalCents, balanceCents);
  const rest = totalCents - credit;
  if (rest > 0 && rest < CARD_MINIMUM_CENTS)
    return Math.max(0, totalCents - CARD_MINIMUM_CENTS);
  return credit;
}

/** How a ledger row reads on the player's account page. */
export function describeCredit(reason: CreditReason): string {
  switch (reason) {
    case "rainout_rebate":
      return "Rain-out rebate";
    case "referral":
      return "Referral";
    case "goodwill":
      return "From the league";
    case "spent":
      return "Used at checkout";
    case "released":
      return "Returned from an unfinished checkout";
  }
}

export type GoodwillForm = { email: string; amount: string; note: string };
export type GoodwillFormErrors = Partial<Record<keyof GoodwillForm, string>>;
export type Goodwill = { email: string; cents: number; note: string };

const MONEY = /^\d{1,5}(\.\d{1,2})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Dollars typed in a form ("15", "$7.50") to cents, or null. */
export function dollarsToCents(raw: string): number | null {
  const value = raw.trim().replace(/^\$/, "");
  if (!MONEY.test(value)) return null;
  const [whole = "0", part = ""] = value.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/**
 * Checks the admin's goodwill form: whose account, how much, and why. The
 * note is required, because it is what the player and the audit log see.
 */
export function parseGoodwillForm(
  form: GoodwillForm,
): Result<Goodwill, GoodwillFormErrors> {
  const errors: GoodwillFormErrors = {};
  const email = form.email.trim().toLowerCase();
  if (!EMAIL.test(email)) errors.email = "Enter the player's email address.";
  const cents = dollarsToCents(form.amount);
  if (cents === null || cents <= 0 || cents > GOODWILL_MAX_CENTS)
    errors.amount = "Enter dollars from 0.01 to 500, such as 15 or 7.50.";
  const note = form.note.trim().replace(/\s+/g, " ");
  if (note.length === 0 || note.length > 200)
    errors.note = "Say why, in up to 200 characters.";
  if (Object.keys(errors).length > 0 || cents === null) return err(errors);
  return ok({ email, cents, note });
}
