import { db } from "@/db/client";
import { eventsFor, feedVersion } from "@/db/queries/event-audience";
import { defaultLeague, leaguesOf } from "@/db/queries/leagues";
import { loadSubject } from "@/db/queries/subject";
import { can } from "@/domain/authz/permissions";
import { eventsFeed } from "@/domain/calendar/events-feed";
import { env } from "@/env";
import { requestOrigin } from "@/lib/calendar-links";
import { feedTokenUser, isFeedToken } from "@/lib/event-feed";

const notFound = () =>
  new Response("No calendar at this link.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

/**
 * A member's private events calendar: every event they can see, members'
 * and team events included. Calendar apps can't sign in, so the signed
 * link is the key (src/lib/event-feed.ts). Never cached by the CDN.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/events/personal/[token]/calendar.ics">,
) {
  const { token } = await ctx.params;
  const userId = feedTokenUser(token);
  if (!userId) return notFound();
  const [version, mine, fallback] = await Promise.all([
    feedVersion(db, userId),
    leaguesOf(db, userId),
    defaultLeague(db),
  ]);
  if (!isFeedToken(env.BETTER_AUTH_SECRET, token, userId, version))
    return notFound();
  // Every league they belong to (ADR 0048), with what they can see in each.
  const leagues = mine.length > 0 ? mine : fallback ? [fallback] : [];
  const events = (
    await Promise.all(
      leagues.map(async (league) => {
        const subject = await loadSubject(db, userId, league.id);
        const found = await eventsFor(
          db,
          league.id,
          userId,
          can(subject, "event.manage", {}),
        );
        return found.map((e) => ({ ...e, league }));
      }),
    )
  )
    .flat()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = leagues[0];
  const body = eventsFeed({
    name:
      leagues.length === 1 && first
        ? `${first.name}: your events`
        : "Your league events",
    timeZone: first?.timeZone ?? "America/New_York",
    origin: requestOrigin(request.headers),
    events,
    now: new Date(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="my-events.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
