"use server";

import { notFound, redirect } from "next/navigation";
import { refreshSeasonPages } from "@/lib/public-cache";
import { db, txDb } from "@/db/client";
import { createBracket, publishBracket } from "@/db/queries/playoffs";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { requirePermissionToChange } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/playoffs`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Seeds the bracket from the standings and saves it as a draft. */
export async function makeBracket(slug: string, form: FormData) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const teams = Number(form.get("teams"));
  const fromDate = form.get("date");
  if (
    !Number.isInteger(teams) ||
    typeof fromDate !== "string" ||
    !DATE.test(fromDate)
  )
    redirect(`${page}?error=bad_input`);
  const result = await createBracket(txDb, {
    seasonId: season.id,
    teams,
    fromDate,
    actorId: subject.userId,
  });
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?drafted=1`);
}

/** Publishes the draft bracket and starts the playoffs. */
export async function publishDraftBracket(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("schedule.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const result = await publishBracket(txDb, season.id, subject.userId);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  // The public bracket is cached; show the published one at once.
  refreshSeasonPages(season.id);
  redirect(`${page}?published=1`);
}
