import { db } from "@/db/client";
import { eventBySlug } from "@/db/queries/events";
import { eventsFeed } from "@/domain/calendar/events-feed";
import { requestOrigin } from "@/lib/calendar-links";

/** One event as a calendar file, to save it to Apple Calendar or Outlook. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/events/[event]/calendar.ics">,
) {
  const { event: slug } = await ctx.params;
  const e = await eventBySlug(db, slug, "public");
  if (!e)
    return new Response("No event with that name.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const body = eventsFeed({
    name: e.title,
    timeZone: e.timeZone,
    origin: requestOrigin(request.headers),
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
