"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  addKeepOff,
  leagueTeams,
  removeKeepOff,
  setExportKeepOffEntries,
} from "@/db/queries/keep-off";
import { currentLeague } from "@/db/queries/seasons";
import { type KeepOffId, parseId, type TeamId } from "@/domain/ids";
import { readEmail, readReason } from "@/domain/keep-off/keep-off";
import { requirePermissionToChange } from "@/lib/auth/permission";

const PAGE = "/app/admin/team-lists";
const back = (code: string) => `${PAGE}?notice=${code}`;

/** An admin adds someone to any team's list in the league. */
export async function addAdminKeepOffAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("keep_off.manage", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  const teamId = parseId<TeamId>(form.get("teamId"));
  const teams = await leagueTeams(db, league.id);
  if (!teamId || !teams.some((t) => t.id === teamId))
    redirect(`${back("unknown_team")}#add`);
  const email = readEmail(form.get("email"));
  if (!email) redirect(`${back("invalid_email")}#add`);
  const reason = readReason(form.get("reason"));
  if (!reason.ok) redirect(`${back(reason.error)}#add`);
  const result = await txDb.transaction((tx) =>
    addKeepOff(tx, {
      teamId,
      email,
      reason: reason.value,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(`${back(result.ok ? "added" : result.error)}#add`);
}

/** An admin takes an entry off any team's list, for example after misuse. */
export async function removeAdminKeepOffAction(rawId: string): Promise<void> {
  const subject = await requirePermissionToChange("keep_off.manage", {
    next: PAGE,
  });
  const id = parseId<KeepOffId>(rawId);
  if (!id) notFound();
  const result = await txDb.transaction((tx) =>
    removeKeepOff(tx, { id, teamId: null, actorId: subject.userId }),
  );
  if (!result.ok) notFound();
  redirect(back("removed"));
}

/** The owners decide whether a person's own export lists entries about them. */
export async function setExportPolicyAction(on: boolean): Promise<void> {
  const subject = await requirePermissionToChange("keep_off.export_policy", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  await txDb.transaction((tx) =>
    setExportKeepOffEntries(tx, {
      leagueId: league.id,
      on,
      actorId: subject.userId,
    }),
  );
  redirect(`${back("policy_saved")}#export`);
}
