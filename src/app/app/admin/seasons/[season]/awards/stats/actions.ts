"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  computeStatAwards,
  saveStatAwardNote,
  setStatAwardsPublished,
} from "@/db/queries/stat-awards";
import {
  isStatAward,
  MVP_PARTS,
  parseNote,
  parseWeights,
} from "@/domain/awards/stat-awards";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";
import { refreshSeasonPages } from "@/lib/public-cache";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/awards/stats`;

async function guard(slug: string) {
  await requireFeature("awards");
  const subject = await requirePermissionToChange("awards.manage", {
    next: pageOf(slug),
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  return { subject, season };
}

/** Works the awards out with the weights on the form and saves the draft. */
export async function computeStatAwardsAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const weights = parseWeights(formStrings(form, MVP_PARTS));
  if (!weights.ok) redirect(`${pageOf(slug)}?error=${weights.error}`);
  const result = await computeStatAwards(txDb, {
    seasonId: season.id,
    weights: weights.value,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  redirect(`${pageOf(slug)}?notice=computed`);
}

/** Saves or clears the note shown under one award. */
export async function saveNoteAction(
  slug: string,
  award: string,
  form: FormData,
): Promise<void> {
  const { subject, season } = await guard(slug);
  if (!isStatAward(award)) notFound();
  const note = parseNote(formStrings(form, ["note"] as const).note);
  if (!note.ok) redirect(`${pageOf(slug)}?error=${note.error}`);
  const result = await saveStatAwardNote(txDb, {
    seasonId: season.id,
    award,
    note: note.value,
    actorId: subject.userId,
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  refreshSeasonPages(season.id);
  redirect(`${pageOf(slug)}?notice=noted#award-${award}`);
}

/** Publishes the awards page, or takes it down. */
export async function publishAction(
  slug: string,
  publish: boolean,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const result = await setStatAwardsPublished(txDb, {
    seasonId: season.id,
    publish,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  refreshSeasonPages(season.id);
  redirect(`${pageOf(slug)}?notice=${publish ? "published" : "unpublished"}`);
}
