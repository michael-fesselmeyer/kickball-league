"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { dayGames, setDayStatus } from "@/db/queries/game-day-status";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseStatusForm } from "@/domain/gameday/status";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshSeasonPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

/**
 * Sets a game day's status (issue #383). Checked against the day's games
 * as they are now; saved under a lock on the day's row, so two admins
 * saving at once take turns. The public pages show it at once, and the
 * players it affects are told right after the response.
 */
export async function setStatusAction(
  slug: string,
  date: string,
  form: FormData,
): Promise<void> {
  const page = `/app/admin/seasons/${slug}/status`;
  const subject = await requirePermissionToChange("game_day.status", {
    next: page,
  });
  // Bound arguments come back from the browser: keep only a real date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const season = await seasonBySlug(db, slug);
  if (!season || season.status === "draft") notFound();
  const back = (query: string) => redirect(`${page}?date=${date}&${query}`);

  const games = await dayGames(db, season.id, date, season.timeZone);
  if (games.length === 0) back("error=no_games");
  const now = new Date();
  const parsed = parseStatusForm(form, {
    date,
    timeZone: season.timeZone,
    games,
    now,
  });
  if (!parsed.ok) back(`error=${parsed.error}`);
  else {
    const result = await txDb.transaction((tx) =>
      setDayStatus(tx, {
        season: {
          id: season.id,
          slug: season.slug,
          name: season.name,
          timeZone: season.timeZone,
        },
        date,
        status: parsed.value,
        games,
        actorId: subject.userId,
        now,
      }),
    );
    refreshSeasonPages(season.id);
    sendQueuedSoon();
    back(
      `notice=${result.told > 0 ? "told" : "saved"}${
        parsed.value.state === "off" ? "&handover=1" : ""
      }`,
    );
  }
}
