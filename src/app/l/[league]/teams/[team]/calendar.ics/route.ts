import { db } from "@/db/client";
import {
  publishedGamesForTeam,
  teamBySlug,
} from "@/db/queries/public-schedule";
import { leagueBySegment } from "@/db/queries/leagues";
import { teamFeed } from "@/domain/calendar/team-feed";
import { leagueBase } from "@/domain/league/paths";
import { requestOrigin } from "@/lib/calendar-links";

/**
 * A team's games as a subscribed calendar (docs/architecture.md, rendering
 * table). Calendar apps poll it; the CDN keeps a copy for a few minutes so a
 * whole team refreshing at once costs one query.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/l/[league]/teams/[team]/calendar.ics">,
) {
  const { league: segment, team: slug } = await ctx.params;
  const league = await leagueBySegment(db, segment);
  const team = league ? await teamBySlug(db, league.id, slug) : null;
  if (!league || !team)
    return new Response("No team with that name.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const games = await publishedGamesForTeam(db, team.id);
  const body = teamFeed({
    teamName: team.name,
    timeZone: team.timeZone,
    // Game links open this league's pages.
    origin: `${requestOrigin(request.headers)}${leagueBase(league)}`,
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
