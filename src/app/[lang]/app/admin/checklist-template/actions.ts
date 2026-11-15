"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  addTemplateTask,
  checklistStaff,
  deleteTemplateTask,
  updateTemplateTask,
} from "@/db/queries/checklist";
import { parseTemplateForm } from "@/domain/checklist/tasks";
import {
  type ChecklistTemplateTaskId,
  type LeagueId,
  parseId,
} from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { activeLeague } from "@/lib/league/active";

const PAGE = "/app/admin/checklist-template";

async function context() {
  const subject = await requirePermissionToChange("checklist.template", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  return { userId: subject.userId, leagueId: league.id };
}

/** The form's days and side ("before" or "after") as days from the start. */
async function templateFrom(form: FormData, leagueId: LeagueId) {
  const values = formStrings(form, [
    "title",
    "notes",
    "days",
    "side",
    "owner",
  ] as const);
  const days = values.days.trim();
  const offsetDays =
    values.side === "before" && days !== "0" && days !== "" ? `-${days}` : days;
  const staff = new Set<string>(
    (await checklistStaff(db, leagueId)).map((s) => s.userId),
  );
  return parseTemplateForm({ ...values, offsetDays }, staff);
}

function templateId(raw: string): ChecklistTemplateTaskId {
  const id = parseId<ChecklistTemplateTaskId>(raw);
  if (!id) redirect(`${PAGE}?error=not_found`);
  return id;
}

export async function addTemplateTaskAction(form: FormData): Promise<void> {
  const { userId, leagueId } = await context();
  const task = await templateFrom(form, leagueId);
  if (!task.ok) redirect(`${PAGE}?error=${task.error}#add`);
  await txDb.transaction((tx) =>
    addTemplateTask(tx, { leagueId, actorId: userId, task: task.value }),
  );
  redirect(`${PAGE}?notice=added`);
}

export async function updateTemplateTaskAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const { userId, leagueId } = await context();
  const id = templateId(rawId);
  const task = await templateFrom(form, leagueId);
  if (!task.ok) redirect(`${PAGE}?error=${task.error}`);
  const result = await txDb.transaction((tx) =>
    updateTemplateTask(tx, {
      id,
      leagueId,
      actorId: userId,
      task: task.value,
    }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  redirect(`${PAGE}?notice=saved`);
}

export async function deleteTemplateTaskAction(rawId: string): Promise<void> {
  const { userId, leagueId } = await context();
  const id = templateId(rawId);
  const result = await txDb.transaction((tx) =>
    deleteTemplateTask(tx, { id, leagueId, actorId: userId }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}`);
  redirect(`${PAGE}?notice=removed`);
}
