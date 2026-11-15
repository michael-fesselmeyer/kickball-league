import { dateTimeFormat } from "@/domain/time/format-cache";
import { LOCALE_TAGS, type Locale } from "./locales";

/**
 * Dates, times, numbers and money in a language's own style (ADR 0094):
 * "Saturday, March 20" in English, "sábado, 20 de marzo" in Spanish. Times
 * are always shown in the league's time zone, which the caller passes.
 */

/** An instant as a date and/or time in `timeZone`, in `locale`'s style. */
export function formatInstant(
  locale: Locale,
  at: Date,
  timeZone: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone">,
): string {
  return dateTimeFormat(LOCALE_TAGS[locale], { ...options, timeZone }).format(
    at,
  );
}

/** A calendar day (YYYY-MM-DD) in `locale`'s style; no time zone applies. */
export function formatDay(
  locale: Locale,
  day: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {
    weekday: "long",
    month: "long",
    day: "numeric",
  },
): string {
  return dateTimeFormat(LOCALE_TAGS[locale], {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

const numbers = new Map<string, Intl.NumberFormat>();

function numberFormat(
  locale: Locale,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = numbers.get(key);
  if (!found) {
    found = new Intl.NumberFormat(LOCALE_TAGS[locale], options);
    numbers.set(key, found);
  }
  return found;
}

/** A count or other number: "1,250" in English, "1250" in Spanish. */
export function formatNumber(locale: Locale, value: number): string {
  return numberFormat(locale, {}).format(value);
}

/**
 * An amount in cents as money: "$85.00" in English, "85,00 US$" in Spanish.
 * Whole amounts drop the cents when `whole` is set: "$85".
 */
export function formatMoney(
  locale: Locale,
  cents: number,
  { currency = "USD", whole = false } = {},
): string {
  const amount = cents / 100;
  const drop = whole && Number.isInteger(amount);
  return numberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: drop ? 0 : 2,
    maximumFractionDigits: drop ? 0 : 2,
  }).format(amount);
}

/** "A, B and C" / "A, B y C". */
export function formatList(locale: Locale, items: readonly string[]): string {
  return new Intl.ListFormat(LOCALE_TAGS[locale], {
    style: "long",
    type: "conjunction",
  }).format(items);
}

/**
 * An ordinal: "3rd" in English; "3.º" in Spanish, or "3.ª" for a feminine
 * noun such as "entrada" (inning). No catalog, so client components can
 * use it.
 */
export function formatOrdinal(
  locale: Locale,
  n: number,
  gender: "masculine" | "feminine" = "masculine",
): string {
  if (locale === "es") return `${n}.${gender === "feminine" ? "ª" : "º"}`;
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
