import { db } from "@/db/client";
import { leagueEvents } from "@/db/queries/events";
import { leagueBySegment } from "@/db/queries/leagues";
import { eventsFeed } from "@/domain/calendar/events-feed";
import { leagueBase } from "@/domain/league/paths";
import { requestOrigin } from "@/lib/calendar-links";

/**
 * The league's events as a subscribed calendar (docs/architecture.md,
 * rendering table). Calendar apps poll it; the CDN keeps a copy for a few
 * minutes so everyone refreshing at once costs one query.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/[lang]/l/[league]/events/calendar.ics">,
) {
  const league = await leagueBySegment(db, (await ctx.params).league);
  const events = league ? await leagueEvents(db, league.id, "public") : [];
  const body = eventsFeed({
    name: league ? `${league.name} events` : "League events",
    timeZone: league?.timeZone ?? "America/New_York",
    // Only public events, whose links open this league's pages.
    origin: `${requestOrigin(request.headers)}${league ? leagueBase(league) : ""}`,
    events,
    now: new Date(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="events.ics"',
      "Cache-Control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
