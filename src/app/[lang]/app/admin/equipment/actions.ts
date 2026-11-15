"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  assignKit,
  createKit,
  resolveReport,
  retireKit,
  setKitHolder,
  unassignKit,
  updateKit,
} from "@/db/queries/equipment";
import { activeLeague } from "@/lib/league/active";
import { parseKitForm } from "@/domain/equipment/equipment";
import {
  type EquipmentAssignmentId,
  type EquipmentKitId,
  type EquipmentReportId,
  type GameId,
  parseId,
  type UserId,
} from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";

const LIST = "/app/admin/equipment";
const pageOf = (kitId: string) => `${LIST}/${kitId}`;

/** An admin of the league, and the league. */
async function guard(next: string) {
  const subject = await requirePermissionToChange("equipment.manage", {
    next,
  });
  const league = await activeLeague();
  if (!league) notFound();
  return { subject, league };
}

const kitIdOf = (raw: string) => {
  const id = parseId<EquipmentKitId>(raw);
  if (!id) notFound();
  return id;
};

const KIT_FIELDS = ["name", "contents", "homeLocation"] as const;

/** Adds a kit. */
export async function createKitAction(form: FormData): Promise<void> {
  const { subject, league } = await guard(LIST);
  const input = parseKitForm(formStrings(form, KIT_FIELDS));
  if (!input.ok) redirect(`${LIST}?error=${input.error}#add`);
  const saved = await txDb.transaction((tx) =>
    createKit(tx, {
      ...input.value,
      leagueId: league.id,
      actorId: subject.userId,
    }),
  );
  if (!saved.ok) redirect(`${LIST}?error=${saved.error}#add`);
  redirect(`${pageOf(saved.value)}?notice=created`);
}

/** Changes a kit's name, contents or home. */
export async function updateKitAction(
  rawKitId: string,
  form: FormData,
): Promise<void> {
  const { subject, league } = await guard(pageOf(rawKitId));
  const kitId = kitIdOf(rawKitId);
  const input = parseKitForm(formStrings(form, KIT_FIELDS));
  if (!input.ok) redirect(`${pageOf(kitId)}?error=${input.error}#details`);
  const saved = await txDb.transaction((tx) =>
    updateKit(tx, {
      ...input.value,
      kitId,
      leagueId: league.id,
      actorId: subject.userId,
    }),
  );
  if (!saved.ok) redirect(`${pageOf(kitId)}?error=${saved.error}#details`);
  redirect(`${pageOf(kitId)}?notice=updated`);
}

/** Retires a kit that is at home. */
export async function retireKitAction(rawKitId: string): Promise<void> {
  const { subject, league } = await guard(pageOf(rawKitId));
  const kitId = kitIdOf(rawKitId);
  const saved = await txDb.transaction((tx) =>
    retireKit(tx, {
      kitId,
      leagueId: league.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!saved.ok) redirect(`${pageOf(kitId)}?error=${saved.error}`);
  redirect(`${LIST}?notice=retired`);
}

/** Assigns the kit to a person for a game. */
export async function assignKitAction(
  rawKitId: string,
  form: FormData,
): Promise<void> {
  const { subject, league } = await guard(pageOf(rawKitId));
  const kitId = kitIdOf(rawKitId);
  const fields = formStrings(form, ["gameId", "userId"] as const);
  const gameId = parseId<GameId>(fields.gameId);
  if (!gameId) redirect(`${pageOf(kitId)}?error=pick_game#assign`);
  const userId = parseId<UserId>(fields.userId);
  if (!userId)
    redirect(`${pageOf(kitId)}?game=${gameId}&error=pick_person#assign`);
  const saved = await txDb.transaction((tx) =>
    assignKit(tx, {
      kitId,
      leagueId: league.id,
      gameId,
      userId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!saved.ok)
    redirect(`${pageOf(kitId)}?game=${gameId}&error=${saved.error}#assign`);
  redirect(`${pageOf(kitId)}?notice=assigned#games`);
}

/** Takes the kit off a game. */
export async function unassignKitAction(
  rawKitId: string,
  rawAssignmentId: string,
): Promise<void> {
  const { subject, league } = await guard(pageOf(rawKitId));
  const kitId = kitIdOf(rawKitId);
  const assignmentId = parseId<EquipmentAssignmentId>(rawAssignmentId);
  if (!assignmentId) notFound();
  const saved = await txDb.transaction((tx) =>
    unassignKit(tx, {
      assignmentId,
      leagueId: league.id,
      actorId: subject.userId,
    }),
  );
  if (!saved.ok) redirect(`${pageOf(kitId)}?error=${saved.error}#games`);
  redirect(`${pageOf(kitId)}?notice=unassigned#games`);
}

/** Says where the kit really is: with a person, or at home (""). */
export async function setHolderAction(
  rawKitId: string,
  rawHolderId: string,
): Promise<void> {
  const { subject, league } = await guard(pageOf(rawKitId));
  const kitId = kitIdOf(rawKitId);
  const holderId = rawHolderId === "" ? null : parseId<UserId>(rawHolderId);
  if (rawHolderId !== "" && !holderId) notFound();
  const saved = await txDb.transaction((tx) =>
    setKitHolder(tx, {
      kitId,
      leagueId: league.id,
      holderId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!saved.ok) redirect(`${pageOf(kitId)}?error=${saved.error}#where`);
  redirect(`${pageOf(kitId)}?notice=moved#where`);
}

/** Marks a missing-items report sorted. */
export async function resolveReportAction(
  rawKitId: string,
  rawReportId: string,
): Promise<void> {
  const { subject, league } = await guard(pageOf(rawKitId));
  const kitId = kitIdOf(rawKitId);
  const reportId = parseId<EquipmentReportId>(rawReportId);
  if (!reportId) notFound();
  const saved = await txDb.transaction((tx) =>
    resolveReport(tx, {
      reportId,
      leagueId: league.id,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!saved.ok) redirect(`${pageOf(kitId)}?error=${saved.error}#reports`);
  redirect(`${pageOf(kitId)}?notice=resolved#reports`);
}
