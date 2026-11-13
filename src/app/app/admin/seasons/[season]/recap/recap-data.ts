import { db } from "@/db/client";
import {
  allPublishedGames,
  publishedSchedule,
} from "@/db/queries/public-schedule";
import { statGamesFrom } from "@/domain/stats/season";
import { gameDays, recapInputFor } from "@/domain/stats/weekly";
import type { SeasonId } from "@/domain/ids";
import { env } from "@/env";
import { absoluteUrl, siteOrigin } from "@/lib/site";

/**
 * What the recap is written from, for the screen and for the AI draft
 * action, so both read the same facts. `day` falls back to the newest
 * game day; null when there are no final scores yet.
 */
export async function recapData(
  season: { id: SeasonId; name: string; slug: string; timeZone: string },
  requestedDay: string | null,
) {
  const [schedule, everything] = await Promise.all([
    publishedSchedule(db, season.id),
    allPublishedGames(db),
  ]);
  const days = gameDays(schedule, season.timeZone);
  const day =
    (requestedDay !== null && days.includes(requestedDay)
      ? requestedDay
      : days[0]) ?? null;
  const input =
    day === null
      ? null
      : recapInputFor({
          seasonName: season.name,
          schedule,
          history: statGamesFrom(everything),
          day,
          timeZone: season.timeZone,
          link: absoluteUrl(
            siteOrigin(env.BETTER_AUTH_URL),
            `/seasons/${season.slug}/standings`,
          ),
        });
  return { days, day, input };
}
