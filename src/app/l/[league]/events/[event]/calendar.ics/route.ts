import { db } from "@/db/client";
import { eventBySlug } from "@/db/queries/events";
import { leagueBySegment } from "@/db/queries/leagues";
import { eventsFeed } from "@/domain/calendar/events-feed";
import { leagueBase } from "@/domain/league/paths";
import { requestOrigin } from "@/lib/calendar-links";

/** One event as a calendar file, to save it to Apple Calendar or Outlook. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/l/[league]/events/[event]/calendar.ics">,
) {
  const { league: segment, event: slug } = await ctx.params;
  const league = await leagueBySegment(db, segment);
  const e = league ? await eventBySlug(db, league.id, slug, "public") : null;
  if (!league || !e || e.leagueId !== league.id)
    return new Response("No event with that name.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const body = eventsFeed({
    name: e.title,
    timeZone: e.timeZone,
    origin: `${requestOrigin(request.headers)}${leagueBase(league)}`,
    events: [e],
    now: new Date(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${e.slug}.ics"`,
      "Cache-Control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
