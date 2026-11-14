import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { publishedSchedule, teamBySlug } from "@/db/queries/public-schedule";
import { widgetSeasons, widgetTeams } from "@/db/queries/widget";
import type { PublicGame } from "@/domain/schedule/public-game";
import {
  nextGameDay,
  TEAM_WIDGET_GAMES,
  upcomingGames,
  widgetSeason,
} from "@/domain/widget/schedule-widget";
import { env } from "@/env";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { PUBLIC_PAGE_LIFE, seasonTag, teamTag } from "@/lib/public-cache";
import { siteOrigin } from "@/lib/site";
import { leagueWidgetHtml, teamWidgetHtml } from "./embed-html";

/**
 * What the schedule widget and the "Get the widget" page read, each inside
 * `use cache` with the season's tag, so the widget is served as a static
 * file and shows a published change on its next load (docs/architecture.md,
 * section 3). "Next" is worked out when the cached copy is made, at least
 * once a minute while sites are showing it.
 */

const DEFAULT_ZONE = "America/New_York";

/** The league's widget page, as HTML. */
export async function leagueWidgetPage(): Promise<string> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  const origin = siteOrigin(env.BETTER_AUTH_URL);
  const read = await readUnlessBuildHasNoDatabase(async () => {
    const season = widgetSeason(await widgetSeasons(db));
    if (!season) return null;
    cacheTag(seasonTag(season.id));
    return { season, games: await publishedSchedule(db, season.id) };
  });
  if (!read)
    return leagueWidgetHtml({
      origin,
      season: null,
      day: null,
      games: [],
      timeZone: DEFAULT_ZONE,
    });
  const { season, games } = read;
  const next = nextGameDay(games, new Date(), season.timeZone);
  return leagueWidgetHtml({
    origin,
    season,
    day: next?.day ?? null,
    games: next?.games ?? [],
    timeZone: season.timeZone,
  });
}

/** One team's widget page, as HTML, or null when there is no such team. */
export async function teamWidgetPage(slug: string): Promise<string | null> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(teamTag(slug));
  const team = await teamBySlug(db, slug);
  if (!team) return null;
  const entry = widgetSeason(
    team.entries.map((e) => ({ ...e, status: e.seasonStatus })),
  );
  let games: PublicGame[] = [];
  if (entry) {
    cacheTag(seasonTag(entry.seasonId));
    const all = await publishedSchedule(db, entry.seasonId);
    games = all.filter(
      (g) => g.teamA.id === entry.id || g.teamB.id === entry.id,
    );
  }
  return teamWidgetHtml({
    origin: siteOrigin(env.BETTER_AUTH_URL),
    team,
    entryId: entry?.id ?? null,
    seasonSlug: entry?.seasonSlug ?? null,
    games: upcomingGames(games, new Date(), TEAM_WIDGET_GAMES),
    timeZone: team.timeZone,
  });
}

/** The season the league's widget follows and its teams, for /widget. */
export async function widgetDirectory() {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  return readUnlessBuildHasNoDatabase(async () => {
    const season = widgetSeason(await widgetSeasons(db));
    if (!season) return { season: null, teams: [] };
    cacheTag(seasonTag(season.id));
    return { season, teams: await widgetTeams(db, season.id) };
  });
}
