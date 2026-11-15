"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  addTask,
  checklistStaff,
  deleteTask,
  setTaskDone,
  startSeasonChecklist,
  updateTask,
} from "@/db/queries/checklist";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseTaskForm } from "@/domain/checklist/tasks";
import { type ChecklistTaskId, type LeagueId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { activeLeagueId } from "@/lib/league/active";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/checklist`;

/** The signed-in owner or admin and the season, for any change here. */
async function context(slug: string) {
  const subject = await requirePermissionToChange("checklist.manage", {
    next: pageFor(slug),
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  return { userId: subject.userId, season };
}

async function taskFrom(form: FormData, leagueId: LeagueId) {
  const values = formStrings(form, [
    "title",
    "notes",
    "dueOn",
    "owner",
  ] as const);
  const staff = new Set<string>(
    (await checklistStaff(db, leagueId)).map((s) => s.userId),
  );
  return parseTaskForm(values, staff);
}

function taskId(slug: string, raw: string): ChecklistTaskId {
  const id = parseId<ChecklistTaskId>(raw);
  if (!id) redirect(`${pageFor(slug)}?error=not_found`);
  return id;
}

/** Copies the league's template into the season (ADR 0061). */
export async function startChecklistAction(slug: string): Promise<void> {
  const { userId, season } = await context(slug);
  const added = await txDb.transaction((tx) =>
    startSeasonChecklist(tx, {
      seasonId: season.id,
      leagueId: season.leagueId,
      startsOn: season.startsOn,
      actorId: userId,
    }),
  );
  redirect(`${pageFor(slug)}?added=${added}`);
}

export async function addTaskAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { userId, season } = await context(slug);
  const task = await taskFrom(form, season.leagueId);
  if (!task.ok) redirect(`${pageFor(slug)}?error=${task.error}#add`);
  await txDb.transaction((tx) =>
    addTask(tx, { seasonId: season.id, actorId: userId, task: task.value }),
  );
  redirect(`${pageFor(slug)}?notice=added`);
}

export async function updateTaskAction(
  slug: string,
  rawId: string,
  form: FormData,
): Promise<void> {
  const { userId, season } = await context(slug);
  const id = taskId(slug, rawId);
  const task = await taskFrom(form, season.leagueId);
  if (!task.ok) redirect(`${pageFor(slug)}?error=${task.error}`);
  const result = await txDb.transaction((tx) =>
    updateTask(tx, {
      id,
      seasonId: season.id,
      actorId: userId,
      task: task.value,
    }),
  );
  if (!result.ok) redirect(`${pageFor(slug)}?error=${result.error}`);
  redirect(`${pageFor(slug)}?notice=saved`);
}

export async function setDoneAction(
  slug: string,
  rawId: string,
  done: boolean,
): Promise<void> {
  const { userId, season } = await context(slug);
  const id = taskId(slug, rawId);
  const result = await txDb.transaction((tx) =>
    setTaskDone(tx, {
      id,
      seasonId: season.id,
      actorId: userId,
      done,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${pageFor(slug)}?error=${result.error}`);
  redirect(`${pageFor(slug)}?notice=${done ? "done" : "reopened"}`);
}

export async function deleteTaskAction(
  slug: string,
  rawId: string,
): Promise<void> {
  const { userId, season } = await context(slug);
  const id = taskId(slug, rawId);
  const result = await txDb.transaction((tx) =>
    deleteTask(tx, { id, seasonId: season.id, actorId: userId }),
  );
  if (!result.ok) redirect(`${pageFor(slug)}?error=${result.error}`);
  redirect(`${pageFor(slug)}?notice=removed`);
}
