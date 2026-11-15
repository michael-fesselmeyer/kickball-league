"use server";

import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { checkInReferee, gameForCheckIn } from "@/db/queries/command-center";
import { isGameDay } from "@/domain/lineup/access";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";

/**
 * The ref's "I'm at the field" on game day, from their home screen. Checks
 * them in to all of that day's games, so the admins' command center shows
 * them as there.
 */
export async function checkInAsRefereeAction(form: FormData) {
  const gameId = parseId<GameId>(form.get("gameId"));
  if (!gameId) notFound();
  const found = await gameForCheckIn(db, gameId);
  if (!found) notFound();
  const now = new Date();
  const subject = await requirePermissionToChange("referee.check_in", {
    next: "/app",
    game: {
      id: found.id,
      teamSeasonIds: [found.teamAId, found.teamBId],
      gameDay: isGameDay(found.startsAt, now, found.timeZone),
    },
  });
  // An admin who also refs checks in as the ref, not for someone else.
  await checkInReferee(db, { gameId, userId: subject.userId, now });
  redirect("/app?checkedIn=1");
}
