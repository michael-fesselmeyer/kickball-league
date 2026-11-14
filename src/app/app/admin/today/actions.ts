"use server";

import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { checkInRefereeFor, gameForCheckIn } from "@/db/queries/command-center";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";

/** An admin marks a game's ref as at the field, for a ref with no phone. */
export async function checkInForRefereeAction(form: FormData) {
  const gameId = parseId<GameId>(form.get("gameId"));
  if (!gameId) notFound();
  const found = await gameForCheckIn(db, gameId);
  if (!found) notFound();
  const subject = await requirePermissionToChange("referee.check_in", {
    next: "/app/admin/today",
    game: { id: found.id, teamSeasonIds: [found.teamAId, found.teamBId] },
  });
  await checkInRefereeFor(db, {
    gameId,
    actorId: subject.userId,
    now: new Date(),
  });
  redirect("/app/admin/today?notice=checked_in");
}
