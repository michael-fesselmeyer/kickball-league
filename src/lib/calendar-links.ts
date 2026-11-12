/**
 * Links that subscribe a calendar app to a team's feed. Apple Calendar and
 * Outlook open webcal:// links; Google Calendar takes the feed as `cid`.
 */
export function calendarLinks(origin: string, teamSlug: string) {
  const feed = `${origin}/teams/${encodeURIComponent(teamSlug)}/calendar.ics`;
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
