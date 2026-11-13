"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { fileIncident, gamePeople } from "@/db/queries/discipline";
import { gameForScoring } from "@/db/queries/scores";
import {
  parseIncidentForm,
  reporterRole,
} from "@/domain/discipline/discipline";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";

/** A ref, a captain in the game or an admin files a report for it. */
export async function fileIncidentAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  await requireFeature("discipline");
  const page = `/app/games/${rawGameId}/incident`;
  const gameId = parseId<GameId>(rawGameId);
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  const gameContext = {
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] as const },
  };
  const subject = await requirePermissionToChange("incident.log", {
    next: page,
    ...gameContext,
  });
  const people = await gamePeople(db, g);
  const values = formStrings(form, ["kind", "details"] as const);
  const parsed = parseIncidentForm(
    {
      ...values,
      people: form.getAll("people").filter((v) => typeof v === "string"),
    },
    new Set(people.map((p) => p.userId)),
  );
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}`);
  const role = reporterRole({
    refereesGame: subject.refereeGameIds.includes(g.id),
    captainsGame: subject.roster.some(
      (m) =>
        (m.teamSeasonId === g.teamAId || m.teamSeasonId === g.teamBId) &&
        (m.role === "captain" || m.role === "co_captain"),
    ),
  });
  const filed = await fileIncident(txDb, {
    gameId: g.id,
    reportedBy: subject.userId,
    role,
    incident: parsed.value,
    now: new Date(),
  });
  if (!filed.ok) redirect(`${page}?error=${filed.error}`);
  redirect(`${page}?filed=1`);
}
