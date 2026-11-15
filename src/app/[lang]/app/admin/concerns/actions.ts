"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  addConcernMessage,
  closeConcern,
  reopenConcern,
} from "@/db/queries/concerns";
import { MAX_BODY, parseText } from "@/domain/concerns/concerns";
import { type ConcernId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireInLeague } from "@/lib/league/guard";
import { activeLeague } from "@/lib/league/active";
import { sendQueuedSoon } from "@/services/outbox";

const pageOf = (id: string) => `/app/admin/concerns/${id}`;

async function guard(rawId: string) {
  const subject = await requirePermissionToChange("concern.review", {
    next: pageOf(rawId),
  });
  const concernId = parseId<ConcernId>(rawId);
  if (!concernId) notFound();
  await requireInLeague(subject, { concern: concernId });
  const league = await activeLeague();
  return { subject, concernId, leagueName: league?.name ?? "The league" };
}

/** Sends a reply to the sender (kind "reply"), or keeps an admin-only note. */
export async function addMessageAction(
  rawId: string,
  kind: "reply" | "note",
  form: FormData,
): Promise<void> {
  const { subject, concernId, leagueName } = await guard(rawId);
  if (kind !== "reply" && kind !== "note") notFound();
  const text = parseText(formStrings(form, ["text"] as const).text, MAX_BODY);
  if (!text.ok) redirect(`${pageOf(rawId)}?error=text`);
  const saved = await addConcernMessage(txDb, {
    concernId,
    authorId: subject.userId,
    kind,
    body: text.value,
    leagueName,
    now: new Date(),
  });
  if (!saved.ok) redirect(`${pageOf(rawId)}?error=${saved.error}`);
  if (kind === "reply") sendQueuedSoon();
  redirect(`${pageOf(rawId)}?notice=${kind}`);
}

/** Closes the concern with what was done; the sender is told. */
export async function closeAction(
  rawId: string,
  form: FormData,
): Promise<void> {
  const { subject, concernId, leagueName } = await guard(rawId);
  const outcome = parseText(
    formStrings(form, ["outcome"] as const).outcome,
    1000,
  );
  if (!outcome.ok) redirect(`${pageOf(rawId)}?error=outcome`);
  const saved = await closeConcern(txDb, {
    concernId,
    actorId: subject.userId,
    outcome: outcome.value,
    leagueName,
    now: new Date(),
  });
  if (!saved.ok) redirect(`${pageOf(rawId)}?error=${saved.error}`);
  sendQueuedSoon();
  redirect(`${pageOf(rawId)}?notice=closed`);
}

export async function reopenAction(rawId: string): Promise<void> {
  const { subject, concernId } = await guard(rawId);
  const saved = await reopenConcern(txDb, {
    concernId,
    actorId: subject.userId,
  });
  if (!saved.ok) redirect(`${pageOf(rawId)}?error=${saved.error}`);
  redirect(`${pageOf(rawId)}?notice=reopened`);
}
