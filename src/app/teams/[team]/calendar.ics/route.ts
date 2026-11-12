import { db } from "@/db/client";
import {
  publishedGamesForTeam,
  teamBySlug,
} from "@/db/queries/public-schedule";
import { teamFeed } from "@/domain/calendar/team-feed";
import { requestOrigin } from "@/lib/calendar-links";

/**
 * A team's games as a subscribed calendar (docs/architecture.md, rendering
 * table). Calendar apps poll it; the CDN keeps a copy for a few minutes so a
 * whole team refreshing at once costs one query.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/teams/[team]/calendar.ics">,
) {
  const { team: slug } = await ctx.params;
  const team = await teamBySlug(db, slug);
  if (!team)
    return new Response("No team with that name.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const games = await publishedGamesForTeam(db, team.id);
  const body = teamFeed({
    teamName: team.name,
    timeZone: team.timeZone,
    origin: requestOrigin(request.headers),
    games,
    now: new Date(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${team.slug}.ics"`,
      "Cache-Control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
