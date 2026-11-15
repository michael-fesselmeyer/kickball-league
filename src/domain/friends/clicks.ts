/**
 * Counting clicks out to the friends directory (docs/data-model.md, section
 * 2.5). Links count through the HTML `ping` attribute: no script, no
 * redirect, and the link still points straight at the club's own site.
 */

/** Where an entry's link pings when someone follows it. */
export const clickPingPath = (id: string) => `/api/friends/${id}/click`;

/**
 * Whether a request is a browser's link ping: it posts `text/ping`, or
 * names the link's target in `Ping-To`. Anything else, such as a form or a
 * script posting by hand, isn't counted.
 */
export function isLinkPing(headers: Headers): boolean {
  const type = headers.get("content-type") ?? "";
  return type.toLowerCase().startsWith("text/ping") || headers.has("ping-to");
}

/** The first day of the "recent" count on the admin page: 30 days back. */
export function recentSince(now: Date): string {
  return new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
}
