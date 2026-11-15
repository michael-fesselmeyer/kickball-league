"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  leagueOfSeason,
  myRefereeGames,
  seasonGameTimes,
  setAvailability,
} from "@/db/queries/referee-pool";
import { parseId, type SeasonId, type UserId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";

const PAGE = "/app/referee";

/**
 * Saves which of a season's game times this ref can work. Only times the
 * season really has, and that haven't started, are taken from the form.
 * A time they already referee a game at stays as it is: taking it back
 * would leave that game's ref saying they can't be there, so they ask an
 * admin to take them off it instead.
 */
export async function saveAvailabilityAction(
  rawSeasonId: string,
  form: FormData,
): Promise<void> {
  const seasonId = parseId<SeasonId>(rawSeasonId);
  if (!seasonId) notFound();
  const leagueId = await leagueOfSeason(db, seasonId);
  if (!leagueId) notFound();
  // A season of another league is refused like a missing one.
  const subject = await requirePermissionToChange("referee.availability", {
    next: PAGE,
    leagueId,
  });
  const userId = parseId<UserId>(subject.userId);
  if (!userId) notFound();
  const now = Date.now();
  const [gameTimes, games] = await Promise.all([
    seasonGameTimes(db, seasonId),
    myRefereeGames(db, { seasonId, userId }),
  ]);
  const reffing = new Set(games.map((g) => g.startsAt.getTime()));
  const real = new Set(
    gameTimes.map((d) => d.getTime()).filter((t) => t > now && !reffing.has(t)),
  );
  const times = (name: string) =>
    form
      .getAll(name)
      .flatMap((v) => (typeof v === "string" ? [Date.parse(v)] : []))
      .filter((t) => real.has(t))
      .map((t) => new Date(t));
  await txDb.transaction((tx) =>
    setAvailability(tx, {
      seasonId,
      userId,
      shown: times("shown"),
      ticked: times("free"),
    }),
  );
  redirect(`${PAGE}?saved=1#season-${seasonId}`);
}
