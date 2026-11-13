"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { lineupGame, saveLineup } from "@/db/queries/lineups";
import { can } from "@/domain/authz/permissions";
import {
  type GameId,
  parseId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";

const builderPage = (gameId: string, teamSeasonId: string) =>
  `/app/games/${gameId}/lineup/${teamSeasonId}`;

/** Saves a team's kicking order; only its captains and admins may. */
export async function saveLineupAction(
  rawGameId: string,
  rawTeamSeasonId: string,
  form: FormData,
): Promise<void> {
  const page = builderPage(rawGameId, rawTeamSeasonId);
  const subject = await requirePermissionToChange("public.view", {
    next: page,
  });
  const gameId = parseId<GameId>(rawGameId);
  const teamSeasonId = parseId<TeamSeasonId>(rawTeamSeasonId);
  const g = gameId ? await lineupGame(db, gameId) : null;
  if (
    !g ||
    !teamSeasonId ||
    (teamSeasonId !== g.teamAId && teamSeasonId !== g.teamBId) ||
    !can(subject, "lineup.edit", { teamSeasonId })
  )
    notFound();
  const raw = form.get("order");
  const parts = typeof raw === "string" && raw !== "" ? raw.split(",") : [];
  const order = parts.flatMap((p) => {
    const id = parseId<UserId>(p);
    return id ? [id] : [];
  });
  if (order.length !== parts.length) redirect(`${page}?error=not_available`);
  const result = await saveLineup(txDb, {
    gameId: g.id,
    teamSeasonId,
    order,
    savedBy: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?saved=${result.value.runBreaks}`);
}
