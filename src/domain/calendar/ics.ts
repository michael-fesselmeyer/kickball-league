import { offsetMinutes } from "@/domain/time/zoned";

/**
 * An iCalendar (RFC 5545) document builder for subscribed calendar feeds.
 * Times are written in the league's time zone with a VTIMEZONE block, so
 * Apple Calendar, Google Calendar and Outlook all show the same wall clock.
 */

export type CalendarEvent = {
  /** Globally unique and stable, so a moved game updates instead of duplicating. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  url?: string;
  geo?: { lat: number; lng: number };
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Raised when the event changes, so clients replace their copy. */
  sequence?: number;
  /**
   * Whole days in the calendar's zone, from the day `start` falls on up to,
   * not including, the day `end` falls on. Shown as free time.
   */
  allDay?: boolean;
};

export type Calendar = {
  name: string;
  description?: string;
  /** An IANA zone such as America/New_York. */
  timeZone: string;
  events: CalendarEvent[];
  /** When the feed was built: every event's DTSTAMP. */
  generatedAt: Date;
  /** How often subscribers should check for changes. */
  refreshMinutes?: number;
};

const CRLF = "\r\n";
const MAX_OCTETS = 75;
const PRODID = "-//Kickball League//Team schedule//EN";

/**
 * Escapes a TEXT value (RFC 5545, section 3.3.11) and drops control
 * characters, which the format does not allow (team names are typed in).
 * Unicode line breaks (U+0085, U+2028, U+2029) become an escaped newline
 * too: many parsers end a line at them and would split the property.
 */
export function escapeText(value: string): string {
  return value

    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|[\r\n\u0085\u2028\u2029]/g, "\\n");
}

const octets = (s: string) => new TextEncoder().encode(s).length;

/**
 * Folds a content line so no line is longer than 75 octets, never splitting
 * a multi-byte character; each continuation line starts with one space.
 */
export function foldLine(line: string): string {
  if (octets(line) <= MAX_OCTETS) return line;
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const n = octets(char);
    // The first line holds 75 octets; continuations hold 74 after the space.
    const limit = lines.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (size + n > limit) {
      lines.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += n;
  }
  lines.push(current);
  return lines.join(`${CRLF} `);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** 20260914T200000 from a Date's UTC fields. */
function basicDateTime(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/** A UTC timestamp: 20260915T000000Z. */
export function utcStamp(instant: Date): string {
  return `${basicDateTime(instant)}Z`;
}

/** The wall-clock reading of an instant in a zone: 20260914T200000. */
export function localStamp(instant: Date, timeZone: string): string {
  const shifted = new Date(
    instant.getTime() + offsetMinutes(instant, timeZone) * 60_000,
  );
  return basicDateTime(shifted);
}

/** -0400 */
function utcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

export type Transition = { at: Date; from: number; to: number };

const DAY = 86_400_000;

/**
 * Every change of UTC offset in a zone between two instants, found by
 * stepping a day at a time and narrowing each change to the minute.
 */
export function offsetTransitions(
  timeZone: string,
  from: Date,
  to: Date,
): Transition[] {
  const found: Transition[] = [];
  let t = from.getTime();
  let offset = offsetMinutes(from, timeZone);
  while (t < to.getTime()) {
    const next = Math.min(t + DAY, to.getTime());
    const nextOffset = offsetMinutes(new Date(next), timeZone);
    if (nextOffset !== offset) {
      // The change is in (t, next]: narrow it to the first minute.
      let lo = t;
      let hi = next;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
        if (offsetMinutes(new Date(mid), timeZone) === offset) lo = mid;
        else hi = mid;
      }
      found.push({ at: new Date(hi), from: offset, to: nextOffset });
      offset = nextOffset;
    }
    t = next;
  }
  return found;
}

function zoneAbbreviation(instant: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** Zone rules do not change while the server runs, so each block is built once. */
const zoneBlocks = new Map<string, string[]>();

/**
 * The VTIMEZONE block for a zone, with one observance per offset change from
 * the year before `from` to the end of `to`'s year, so every event in that
 * range falls after an onset. A zone without changes gets one fixed offset.
 */
export function vtimezone(timeZone: string, from: Date, to: Date): string[] {
  const key = `${timeZone}|${from.getUTCFullYear()}|${to.getUTCFullYear()}`;
  const cached = zoneBlocks.get(key);
  if (cached) return cached;
  const start = new Date(Date.UTC(from.getUTCFullYear() - 1, 0, 1));
  const end = new Date(Date.UTC(to.getUTCFullYear() + 1, 0, 1));
  const transitions = offsetTransitions(timeZone, start, end);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
  if (transitions.length === 0) {
    const offset = utcOffset(offsetMinutes(start, timeZone));
    lines.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${offset}`,
      `TZOFFSETTO:${offset}`,
      `TZNAME:${zoneAbbreviation(start, timeZone)}`,
      "END:STANDARD",
    );
  }
  for (const { at, from: before, to: after } of transitions) {
    const kind = after > before ? "DAYLIGHT" : "STANDARD";
    lines.push(
      `BEGIN:${kind}`,
      // The onset is the wall clock just before the change, in the old offset.
      `DTSTART:${basicDateTime(new Date(at.getTime() + before * 60_000))}`,
      `TZOFFSETFROM:${utcOffset(before)}`,
      `TZOFFSETTO:${utcOffset(after)}`,
      `TZNAME:${zoneAbbreviation(at, timeZone)}`,
      `END:${kind}`,
    );
  }
  lines.push("END:VTIMEZONE");
  zoneBlocks.set(key, lines);
  return lines;
}

function eventLines(
  event: CalendarEvent,
  timeZone: string,
  stamp: string,
): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    ...(event.allDay
      ? [
          `DTSTART;VALUE=DATE:${localStamp(event.start, timeZone).slice(0, 8)}`,
          `DTEND;VALUE=DATE:${localStamp(event.end, timeZone).slice(0, 8)}`,
        ]
      : [
          `DTSTART;TZID=${timeZone}:${localStamp(event.start, timeZone)}`,
          `DTEND;TZID=${timeZone}:${localStamp(event.end, timeZone)}`,
        ]),
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.geo)
    lines.push(`GEO:${event.geo.lat.toFixed(6)};${event.geo.lng.toFixed(6)}`);
  if (event.description)
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(`STATUS:${event.status ?? "CONFIRMED"}`);
  if (event.sequence !== undefined) lines.push(`SEQUENCE:${event.sequence}`);
  lines.push(
    event.allDay ? "TRANSP:TRANSPARENT" : "TRANSP:OPAQUE",
    "END:VEVENT",
  );
  return lines;
}

/** The whole feed as text: CRLF line endings, folded, ending in CRLF. */
export function buildCalendar(calendar: Calendar): string {
  const { timeZone, events, generatedAt } = calendar;
  const refresh = `PT${calendar.refreshMinutes ?? 60}M`;
  const starts = events.map((e) => e.start.getTime());
  const first = new Date(starts.length ? Math.min(...starts) : +generatedAt);
  const last = new Date(starts.length ? Math.max(...starts) : +generatedAt);
  const stamp = utcStamp(generatedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    `X-WR-TIMEZONE:${timeZone}`,
    ...(calendar.description
      ? [`X-WR-CALDESC:${escapeText(calendar.description)}`]
      : []),
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
    ...vtimezone(timeZone, first, last),
    ...events.flatMap((e) => eventLines(e, timeZone, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
