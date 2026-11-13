/**
 * Links that subscribe a calendar app to a team's feed. Apple Calendar and
 * Outlook open webcal:// links; Google Calendar takes the feed as `cid`.
 */
export function calendarLinks(origin: string, teamSlug: string) {
  return feedLinks(
    `${origin}/teams/${encodeURIComponent(teamSlug)}/calendar.ics`,
  );
}

/** The league's events calendar (src/app/events/calendar.ics). */
export const eventsCalendarLinks = (origin: string) =>
  feedLinks(`${origin}/events/calendar.ics`);

/** Subscribe links for any calendar feed. */
export function feedLinks(feed: string) {
  const webcal = feed.replace(/^https?:/, "webcal:");
  return {
    feed,
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
  };
}

/** The site's origin as the visitor reached it, behind a proxy or not. */
export function requestOrigin(headers: Headers): string {
  const host =
    headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (local ? "http" : "https");
  return `${proto}://${host}`;
}

const googleStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/**
 * A Google Calendar link that adds one event. A whole-day event takes its
 * first day and the day after its last, as YYYYMMDD dates.
 */
export function googleEventLink(e: {
  title: string;
  details: string;
  place: string | null;
  start: Date;
  end: Date;
  allDay?: { first: string; afterLast: string };
}): string {
  const dates = e.allDay
    ? `${e.allDay.first.replace(/-/g, "")}/${e.allDay.afterLast.replace(/-/g, "")}`
    : `${googleStamp(e.start)}/${googleStamp(e.end)}`;
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates,
    details: e.details,
  });
  if (e.place) query.set("location", e.place);
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}
