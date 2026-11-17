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

/** "A, B and C" / "A, B y C" / "A, B ak C". */
export function formatList(locale: Locale, items: readonly string[]): string {
  // The formatting data has no Haitian Creole; its lists join with "ak".
  if (locale === "ht")
    return items.length < 2
      ? (items[0] ?? "")
      : `${items.slice(0, -1).join(", ")} ak ${items.at(-1)}`;
  return new Intl.ListFormat(LOCALE_TAGS[locale], {
    style: "long",
    type: "conjunction",
  }).format(items);
}

/**
 * An ordinal: "3rd" in English; "3.º" in Spanish, or "3.ª" for a feminine
 * noun such as "entrada" (inning). Languages that put the ordinal in the
 * phrase around it get what their catalog's phrase expects: "第3" for
 * "第3名", the bare number for Korean "3회" and Russian "3-й", "3." in
 * Polish, "3yèm" in Creole and "3য়" in Bengali. No catalog, so client
 * components can use it.
 */
export function formatOrdinal(
  locale: Locale,
  n: number,
  gender: "masculine" | "feminine" = "masculine",
): string {
  switch (locale) {
    case "es":
      return `${n}.${gender === "feminine" ? "ª" : "º"}`;
    case "it":
      return `${n}${gender === "feminine" ? "ª" : "º"}`;
    case "fr":
      if (n === 1) return gender === "feminine" ? "1re" : "1er";
      return `${n}e`;
    case "zh":
      return `第${n}`;
    case "ko":
    case "ru":
      return `${n}`;
    case "pl":
      return `${n}.`;
    case "ht":
      return n === 1 ? "1ye" : `${n}yèm`;
    case "bn":
      return `${n}${bengaliSuffix(n)}`;
    case "en": {
      const tens = n % 100;
      if (tens >= 11 && tens <= 13) return `${n}th`;
      const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
      return `${n}${suffix}`;
    }
  }
}

/** Bengali ordinal endings: ১ম, ২য়, ৩য়, ৪র্থ, ৫ম…১০ম, ৬ষ্ঠ, then -তম. */
function bengaliSuffix(n: number): string {
  if (n === 2 || n === 3) return "য়";
  if (n === 4) return "র্থ";
  if (n === 6) return "ষ্ঠ";
  if (n >= 1 && n <= 10) return "ম";
  return "তম";
}
