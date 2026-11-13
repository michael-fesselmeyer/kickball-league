"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  addIncidentNote,
  liftSuspension,
  setIncidentStatus,
  suspendPlayer,
} from "@/db/queries/discipline";
import { parseLength, parseNote } from "@/domain/discipline/discipline";
import {
  type IncidentId,
  parseId,
  type SuspensionId,
  type UserId,
} from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";
import { sendQueuedSoon } from "@/services/outbox";

const pageOf = (id: string) => `/app/admin/incidents/${id}`;

/** The right each action needs: reviewing, or deciding a suspension. */
type Right = "incident.review" | "player.suspend";

async function guard(right: Right, rawId: string) {
  await requireFeature("discipline");
  const subject = await requirePermissionToChange(right, {
    next: pageOf(rawId),
  });
  const incidentId = parseId<IncidentId>(rawId);
  if (!incidentId) notFound();
  return { subject, incidentId };
}

/** An admin's note on a report. */
export async function addNoteAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const { subject, incidentId } = await guard("incident.review", rawId);
  const note = parseNote(formStrings(form, ["note"] as const).note);
  if (!note.ok) redirect(`${pageOf(rawId)}?error=${note.error}#notes`);
  const saved = await addIncidentNote(txDb, {
    incidentId,
    authorId: subject.userId,
    body: note.value,
    now: new Date(),
  });
  if (!saved.ok) redirect(`${pageOf(rawId)}?error=${saved.error}`);
  redirect(`${pageOf(rawId)}?notice=noted#notes`);
}

/** Marks a report resolved, or opens it again. */
export async function setStatusAction(
  rawId: string,
  status: "open" | "resolved",
): Promise<void> {
  const { subject, incidentId } = await guard("incident.review", rawId);
  // Bound arguments come back from the browser, so check them again.
  if (status !== "open" && status !== "resolved") notFound();
  const saved = await setIncidentStatus(txDb, {
    incidentId,
    actorId: subject.userId,
    status,
    now: new Date(),
  });
  if (!saved.ok) redirect(`${pageOf(rawId)}?error=${saved.error}`);
  redirect(`${pageOf(rawId)}?notice=${status}`);
}

/** Suspends a person named on the report, and emails them. */
export async function suspendAction(
  rawId: string,
  rawUserId: string,
  form: FormData,
): Promise<void> {
  const { subject, incidentId } = await guard("player.suspend", rawId);
  const userId = parseId<UserId>(rawUserId);
  if (!userId) notFound();
  const length = parseLength(formStrings(form, ["scope", "games"] as const));
  if (!length.ok) redirect(`${pageOf(rawId)}?error=${length.error}#suspend`);
  const done = await suspendPlayer(txDb, {
    incidentId,
    userId,
    length: length.value,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!done.ok) redirect(`${pageOf(rawId)}?error=${done.error}#suspend`);
  sendQueuedSoon();
  redirect(`${pageOf(rawId)}?notice=suspended#suspensions`);
}

/** Ends a suspension early, for example after an appeal. */
export async function liftAction(
  rawId: string,
  rawSuspensionId: string,
): Promise<void> {
  const { subject } = await guard("player.suspend", rawId);
  const suspensionId = parseId<SuspensionId>(rawSuspensionId);
  if (!suspensionId) notFound();
  const done = await liftSuspension(txDb, {
    suspensionId,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!done.ok) redirect(`${pageOf(rawId)}?error=${done.error}`);
  redirect(`${pageOf(rawId)}?notice=lifted#suspensions`);
}
