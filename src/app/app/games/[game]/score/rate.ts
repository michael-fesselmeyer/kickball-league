"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { rateGame } from "@/db/queries/discipline";
import { gameForScoring } from "@/db/queries/scores";
import { parseRating } from "@/domain/discipline/discipline";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";

/** A captain rates the other team's sportsmanship once the score is final. */
export async function rateSportsmanshipAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  await requireFeature("discipline");
  const page = `/app/games/${rawGameId}/score`;
  const gameId = parseId<GameId>(rawGameId);
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  const subject = await requirePermissionToChange("sportsmanship.rate", {
    next: page,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
  });
  const mine = [g.teamAId, g.teamBId].find((t) =>
    subject.roster.some(
      (m) =>
        m.teamSeasonId === t &&
        (m.role === "captain" || m.role === "co_captain"),
    ),
  );
  if (!mine) notFound();
  const parsed = parseRating(formStrings(form, ["score", "note"] as const));
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}#sportsmanship`);
  const saved = await rateGame(txDb, {
    gameId: g.id,
    teamSeasonId: mine,
    ratedBy: subject.userId,
    rating: parsed.value,
    now: new Date(),
  });
  if (!saved.ok) redirect(`${page}?error=${saved.error}#sportsmanship`);
  redirect(`${page}?rated=1#sportsmanship`);
}
