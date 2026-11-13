import Link from "next/link";
import { inviteHost } from "@/domain/events/audience";
import {
  type EventKind,
  KIND_LABELS,
  spotsLeft,
  whenLine,
} from "@/domain/events/event";
import { priceLine } from "@/domain/events/tickets";

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
export function spotsLine(e: EventCardData, now: Date): string | null {
  const spots = roomLine(e, now);
  if (e.cancelledAt || e.endsAt <= now) return spots;
  const price = priceLine({
    ticketPriceCents: e.ticketPriceCents ?? null,
    memberPriceCents: e.memberPriceCents ?? null,
  });
  if (!price) return spots;
  return spots ? `${price} · ${spots}` : price;
}

function roomLine(e: EventCardData, now: Date): string | null {
  if (e.cancelledAt) return "Called off";
  if (e.endsAt <= now) return null;
  if (e.kind === "theme_week") return null;
  if (!e.inAppRsvp)
    return e.inviteUrl ? `RSVP on ${inviteHost(e.inviteUrl)}` : null;
  const left = spotsLeft(e.capacity, e.going);
  if (left === null) return e.going > 0 ? `${e.going} going` : null;
  if (left === 0) return "Full: waitlist open";
  return left === 1 ? "1 spot left" : `${left} spots left`;
}

/** The month and day in a tear-off block, like a wall calendar. */
function DateBlock({ at, timeZone }: { at: Date; timeZone: string }) {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(at);
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
  event: e,
  timeZone,
  now,
  href = `/events/${e.slug}`,
  note,
  tag,
}: {
  event: EventCardData;
  timeZone: string;
  now: Date;
  href?: string;
  /** A line about the viewer, such as "You're going". */
  note?: string | null | undefined;
  /** Who it's for, when that isn't everyone: "Members only". */
  tag?: string | null | undefined;
}) {
  const spots = spotsLine(e, now);
  const cancelled = e.cancelledAt !== null;
  return (
    <Link
      href={href}
      className="flex min-h-11 items-start gap-3 rounded-card border border-border bg-surface p-3 shadow-card hover:bg-surface-2"
    >
      <DateBlock at={e.startsAt} timeZone={timeZone} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-micro font-bold tracking-wide text-text-muted uppercase">
          {tag ? `${KIND_LABELS[e.kind]} · ${tag}` : KIND_LABELS[e.kind]}
        </span>
        <span
          className={`font-display text-h3 leading-tight font-bold ${cancelled ? "line-through decoration-2" : ""}`}
        >
          {e.title}
        </span>
        <span className="text-small">{whenLine(e, timeZone)}</span>
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
