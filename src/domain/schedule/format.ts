import { dateTimeFormat } from "@/domain/time/format-cache";
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from "@/i18n/locales";

/**
 * Dates and times for the public pages, always in the league's time zone,
 * in the page's language (ADR 0065); English unless a language is given.
 */

/** "Monday, September 14" from a YYYY-MM-DD local date. */
export function dayHeading(
  day: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return dateTimeFormat(LOCALE_TAGS[locale], {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** "8:00 PM" */
export function kickoff(
  instant: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return dateTimeFormat(LOCALE_TAGS[locale], {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/** "Mon, Sep 14" */
export function shortDay(
  instant: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return dateTimeFormat(LOCALE_TAGS[locale], {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(instant);
}

/** "Monday, September 14, 2026 at 8:00 PM EDT" */
export function fullWhen(
  instant: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return dateTimeFormat(LOCALE_TAGS[locale], {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}
