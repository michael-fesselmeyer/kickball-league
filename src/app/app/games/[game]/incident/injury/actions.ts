"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { fileIncident, gamePeople } from "@/db/queries/discipline";
import { gameForScoring } from "@/db/queries/scores";
import { reporterRole } from "@/domain/discipline/discipline";
import { parseInjuryForm } from "@/domain/discipline/injury";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";
import { sendQueuedSoon } from "@/services/outbox";

/**
 * The game's ref, a captain in the game or an admin files an injury report
 * (ADR 0064): the same people, rights and rules as any incident report. The
 * league's owners and admins are told a report was filed, and only that.
 */
export async function fileInjuryAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  await requireFeature("discipline");
  const page = `/app/games/${rawGameId}/incident/injury`;
  const gameId = parseId<GameId>(rawGameId);
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  const subject = await requirePermissionToChange("incident.log", {
    next: page,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] as const },
  });
  const people = await gamePeople(db, g);
  const values = formStrings(form, [
    "hurt",
    "bodyArea",
    "care",
    "details",
  ] as const);
  const parsed = parseInjuryForm(
    {
      ...values,
      witnesses: form.getAll("witnesses").filter((v) => typeof v === "string"),
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
    incident: {
      kind: "injury",
      details: parsed.value.details,
      people: [],
      parkRule: null,
    },
    injury: parsed.value,
    now: new Date(),
  });
  if (!filed.ok) redirect(`${page}?error=${filed.error}`);
  sendQueuedSoon();
  redirect(`${page}?filed=1`);
}
