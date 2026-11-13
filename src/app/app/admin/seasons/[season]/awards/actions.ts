"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  closePollNow,
  gameDaysOf,
  openPoll,
  removePoll,
} from "@/db/queries/awards";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parsePollForm } from "@/domain/awards/awards";
import { type AwardPollId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/awards`;

async function guard(slug: string) {
  await requireFeature("awards");
  const subject = await requirePermissionToChange("awards.manage", {
    next: pageOf(slug),
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  return { subject, season };
}

/** Opens a weekly or season poll; voting starts now. */
export async function openPollAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const values = formStrings(form, [
    "kind",
    "category",
    "gameDay",
    "title",
    "closesOn",
    "closesTime",
  ] as const);
  const parsed = parsePollForm(values, {
    now: new Date(),
    timeZone: season.timeZone,
    seasonName: season.name,
    gameDays: await gameDaysOf(db, season.id),
  });
  if (!parsed.ok) redirect(`${pageOf(slug)}?error=${parsed.error}`);
  await openPoll(txDb, {
    seasonId: season.id,
    poll: parsed.value,
    actorId: subject.userId,
  });
  redirect(`${pageOf(slug)}?notice=opened`);
}

/** Ends voting now so the results show. */
export async function closePollAction(
  slug: string,
  rawPollId: string,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const pollId = parseId<AwardPollId>(rawPollId);
  if (!pollId) notFound();
  const result = await closePollNow(txDb, {
    pollId,
    seasonId: season.id,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  redirect(`${pageOf(slug)}?notice=closed`);
}

/** Removes a poll and every vote in it. */
export async function removePollAction(
  slug: string,
  rawPollId: string,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const pollId = parseId<AwardPollId>(rawPollId);
  if (!pollId) notFound();
  const result = await removePoll(txDb, {
    pollId,
    seasonId: season.id,
    actorId: subject.userId,
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  redirect(`${pageOf(slug)}?notice=removed`);
}
