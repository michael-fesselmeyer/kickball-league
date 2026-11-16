import { err, ok, type Result } from "@/domain/result";
import { dateTimeFormat } from "@/domain/time/format-cache";
import { fill } from "@/i18n/catalog";
import { formatList } from "@/i18n/format";
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";

/**
 * A sponsor's deals: when each one applies, how to say so, and reading the
 * deal form. Days are ISO weekdays, 1 Monday to 7 Sunday; times are HH:MM
 * in the league's time zone. Pure: the caller passes the local day and time.
 */

export type DealTerms = {
  title: string;
  terms: string | null;
  validDays: readonly number[];
  /** "HH:MM" or "HH:MM:SS"; both null for all day. */
  validFrom: string | null;
  validTo: string | null;
};

export const WEEKDAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const;

/** The ISO weekday of a YYYY-MM-DD date. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const hhmm = (time: string) => time.slice(0, 5);

/**
 * Whether a deal applies on `day` at `time`. A window that ends before it
 * starts runs past midnight, and its late hours count for the day it
 * started on.
 */
export function dealApplies(
  deal: Pick<DealTerms, "validDays" | "validFrom" | "validTo">,
  day: string,
  time: string,
): boolean {
  const onDay = (d: number) =>
    deal.validDays.length === 0 || deal.validDays.includes(d);
  const weekday = isoWeekday(day);
  if (deal.validFrom === null || deal.validTo === null) return onDay(weekday);
  const from = hhmm(deal.validFrom);
  const to = hhmm(deal.validTo);
  const now = hhmm(time);
  if (from <= to) return onDay(weekday) && now >= from && now < to;
  // Past midnight: the evening part today, or the small hours of yesterday's.
  const yesterday = weekday === 1 ? 7 : weekday - 1;
  return (onDay(weekday) && now >= from) || (onDay(yesterday) && now < to);
}

/** Whether a deal is offered at all on `day`, whatever the time. */
export function dealOnDay(
  deal: Pick<DealTerms, "validDays">,
  day: string,
): boolean {
  return (
    deal.validDays.length === 0 || deal.validDays.includes(isoWeekday(day))
  );
}

function clock(time: string, locale: Locale): string {
  const [h = 0, m = 0] = hhmm(time).split(":").map(Number);
  if (locale !== DEFAULT_LOCALE) {
    const words = messagesFor(locale).deals;
    if (h === 0 && m === 0) return words.midnight;
    if (h === 12 && m === 0) return words.noon;
    return dateTimeFormat(LOCALE_TAGS[locale], {
      timeZone: "UTC",
      hour: "numeric",
      ...(m === 0 ? {} : { minute: "2-digit" }),
    }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
  }
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  if (h === 0 && m === 0) return "midnight";
  if (h === 12 && m === 0) return "noon";
  return m === 0
    ? `${hour} ${suffix}`
    : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function dayList(days: readonly number[], locale: Locale): string {
  if (locale !== DEFAULT_LOCALE) {
    const names = messagesFor(locale).deals.days;
    // "Los martes y los jueves": only the first is capitalized.
    return formatList(
      locale,
      WEEKDAYS.filter(([d]) => days.includes(d)).map(([d], i) =>
        i === 0 ? names[d] : names[d].toLowerCase(),
      ),
    );
  }
  const names = WEEKDAYS.filter(([d]) => days.includes(d)).map(
    ([, name]) => `${name}s`,
  );
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Every day", "Tuesdays and Thursdays, 6 PM to 10 PM", "Every day, after 9 PM". */
export function dealWhen(
  deal: Pick<DealTerms, "validDays" | "validFrom" | "validTo">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const words = messagesFor(locale).deals;
  const unique = [...new Set(deal.validDays)];
  const days =
    unique.length === 0 || unique.length === 7
      ? words.everyDay
      : unique.length === 5 && unique.every((d) => d <= 5)
        ? words.weekdays
        : unique.length === 2 && unique.every((d) => d >= 6)
          ? words.weekends
          : dayList(unique, locale);
  if (deal.validFrom === null || deal.validTo === null) return days;
  return fill(words.between, {
    days,
    from: clock(deal.validFrom, locale),
    to: clock(deal.validTo, locale),
  });
}

export type DealFormError =
  | "title_missing"
  | "title_too_long"
  | "terms_too_long"
  | "bad_time"
  | "half_time";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Reads the deal form: title, terms, a checkbox per weekday named `day`
 * and an optional from/to time. Every day ticked is stored as "every day".
 */
export function parseDealForm(fields: {
  title: string;
  terms: string;
  days: readonly string[];
  from: string;
  to: string;
}): Result<DealTerms, DealFormError> {
  const title = fields.title.trim();
  const terms = fields.terms.trim();
  if (!title) return err("title_missing");
  if (title.length > 80) return err("title_too_long");
  if (terms.length > 300) return err("terms_too_long");
  const days = [
    ...new Set(
      fields.days
        .map(Number)
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    ),
  ].sort((a, b) => a - b);
  const from = fields.from.trim();
  const to = fields.to.trim();
  if ((from === "") !== (to === "")) return err("half_time");
  if (from && (!TIME.test(from) || !TIME.test(to))) return err("bad_time");
  if (from && from === to) return err("bad_time");
  return ok({
    title,
    terms: terms || null,
    validDays: days.length === 7 ? [] : days,
    validFrom: from || null,
    validTo: to || null,
  });
}

export const DEAL_FORM_ERRORS: Record<DealFormError, string> = {
  title_missing: "Give the deal a name, like “$2 off any burger”.",
  title_too_long: "Keep the deal's name to 80 characters.",
  terms_too_long: "Keep the fine print to 300 characters.",
  bad_time: "Use a start and an end time that are different.",
  half_time: "Give both a start and an end time, or neither for all day.",
};

/**
 * When the sponsor last said a deal is current, for the public page:
 * "Confirmed Nov 10". A date, not "3 days ago", so a cached page stays true.
 */
export function confirmedLabel(
  confirmedOn: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return fill(messagesFor(locale).deals.confirmed, {
    date: dateTimeFormat(LOCALE_TAGS[locale], {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(new Date(`${confirmedOn}T12:00:00Z`)),
  });
}
