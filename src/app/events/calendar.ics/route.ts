import { db } from "@/db/client";
import { leagueEvents } from "@/db/queries/events";
import { currentLeague } from "@/db/queries/seasons";
import { eventsFeed } from "@/domain/calendar/events-feed";
import { requestOrigin } from "@/lib/calendar-links";

/**
 * The league's events as a subscribed calendar (docs/architecture.md,
 * rendering table). Calendar apps poll it; the CDN keeps a copy for a few
 * minutes so everyone refreshing at once costs one query.
 */
export async function GET(request: Request) {
  const league = await currentLeague(db);
  const events = league ? await leagueEvents(db, league.id) : [];
  const body = eventsFeed({
    name: league ? `${league.name} events` : "League events",
    timeZone: league?.timeZone ?? "America/New_York",
    origin: requestOrigin(request.headers),
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
