import Link from "next/link";
import { inviteSite } from "@/domain/events/audience";
import { type EventKind, spotsLeft, whenLine } from "@/domain/events/event";
import { priceLine } from "@/domain/events/tickets";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { dateTimeFormat } from "@/domain/time/format-cache";
import { fill, plural } from "@/i18n/catalog";
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

export type EventCardData = {
  slug: string;
  kind: EventKind;
  title: string;
  place: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  cancelledAt: Date | null;
  going: number;
  inAppRsvp: boolean;
  inviteUrl: string | null;
  /** A ticketed event's prices; a free event has none. */
  ticketPriceCents?: number | null;
  memberPriceCents?: number | null;
};

/**
 * "6 spots left", "Full: waitlist open", "RSVP on partiful.com", or nothing
 * when there is no limit; a ticketed event leads with its price: "$15 · 6
 * spots left".
 */
export function spotsLine(
  e: EventCardData,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const spots = roomLine(e, now, locale);
  if (e.cancelledAt || e.endsAt <= now) return spots;
  const price = priceLine(
    {
      ticketPriceCents: e.ticketPriceCents ?? null,
      memberPriceCents: e.memberPriceCents ?? null,
    },
    locale,
  );
  if (!price) return spots;
  return spots ? `${price} · ${spots}` : price;
}

function roomLine(e: EventCardData, now: Date, locale: Locale): string | null {
  const words = messagesFor(locale).eventCard;
  if (e.cancelledAt) return words.calledOff;
  if (e.endsAt <= now) return null;
  if (e.kind === "theme_week") return null;
  if (!e.inAppRsvp)
    return e.inviteUrl
      ? fill(words.rsvpOn, { site: inviteSite(e.inviteUrl) })
      : null;
  const left = spotsLeft(e.capacity, e.going);
  if (left === null)
    return e.going > 0 ? fill(words.going, { n: e.going }) : null;
  if (left === 0) return words.full;
  return plural(locale, words.spotsLeft, left);
}

/** The month and day in a tear-off block, like a wall calendar. */
function DateBlock({
  at,
  timeZone,
  locale,
}: {
  at: Date;
  timeZone: string;
  locale: Locale;
}) {
  const part = (options: Intl.DateTimeFormatOptions) =>
    dateTimeFormat(LOCALE_TAGS[locale], { timeZone, ...options })
      .format(at)
      .replace(/\.$/, "");
  return (
    <span
      aria-hidden="true"
      className="flex w-14 shrink-0 flex-col items-center rounded-input border-2 border-text bg-bg py-1"
    >
      <span className="text-micro font-bold tracking-wide uppercase">
        {part({ month: "short" })}
      </span>
      <span className="font-display text-h3 leading-none font-extrabold tabular-nums">
        {part({ day: "numeric" })}
      </span>
    </span>
  );
}

/**
 * One event in a list: when, what, where, and whether there's room. Opens
 * `href`, the public page unless a signed-in list says otherwise.
 */
export function EventCard({
  league,
  event: e,
  timeZone,
  now,
  locale = DEFAULT_LOCALE,
  href = linkIn(locale, leagueHref(league, `/events/${e.slug}`)),
  note,
  tag,
}: {
  /** The league whose public pages the links open (ADR 0048). */
  league: LeagueRef;
  event: EventCardData;
  timeZone: string;
  now: Date;
  /** The page's language (ADR 0065); English unless given. */
  locale?: Locale;
  href?: string;
  /** A line about the viewer, such as "You're going". */
  note?: string | null | undefined;
  /** Who it's for, when that isn't everyone: "Members only". */
  tag?: string | null | undefined;
}) {
  const words = messagesFor(locale);
  const kind = words.eventKinds[e.kind];
  const spots = spotsLine(e, now, locale);
  const cancelled = e.cancelledAt !== null;
  return (
    <Link
      href={href}
      className="flex min-h-11 items-start gap-3 rounded-card border border-border bg-surface p-3 shadow-card hover:bg-surface-2"
    >
      <DateBlock at={e.startsAt} timeZone={timeZone} locale={locale} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-micro font-bold tracking-wide text-text-muted uppercase">
          {tag ? fill(words.eventCard.tagged, { kind, tag }) : kind}
        </span>
        <span
          className={`font-display text-h3 leading-tight font-bold ${cancelled ? "line-through decoration-2" : ""}`}
        >
          {e.title}
        </span>
        <span className="text-small">{whenLine(e, timeZone, locale)}</span>
        {e.place && (
          <span className="text-small text-text-muted">{e.place}</span>
        )}
        {(spots || note) && (
          <span className="flex flex-wrap gap-x-3 text-small font-bold">
            {spots && (
              <span className={cancelled ? "text-danger" : ""}>{spots}</span>
            )}
            {note && <span className="text-brand">{note}</span>}
          </span>
        )}
      </span>
    </Link>
  );
}
