"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  loadSchedulerInput,
  publishVersion,
  saveVersion,
} from "@/db/queries/schedule";
import { seasonBySlug, versionsOf } from "@/db/queries/schedule-screen";
import type { ScheduleVersionId } from "@/domain/ids";
import { generate } from "@/domain/scheduler/generate";
import { requirePermission } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/schedule`;

/** A whole number from the form within [min, max], or null. */
function whole(form: FormData, name: string, min: number, max: number) {
  const value = Number(form.get(name));
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Generates a new draft version from the season as it stands. */
export async function generateDraft(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermission("schedule.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();

  const rounds = whole(form, "rounds", 1, 60);
  const reservePerDay = whole(form, "reserve", 0, 20);
  const seed = whole(form, "seed", 0, 2_147_483_647);
  if (rounds === null || reservePerDay === null || seed === null)
    redirect(`${page}?error=bad_input`);

  const loaded = await loadSchedulerInput(db, season.id, {
    rounds,
    reservePerDay,
    seed,
  });
  if (!loaded.ok) notFound();
  const [latest] = await versionsOf(db, season.id);
  await saveVersion(txDb, {
    seasonId: season.id,
    input: loaded.value,
    schedule: generate(loaded.value),
    origin: "generated",
    ...(latest ? { parentVersionId: latest.id } : {}),
    createdBy: subject.userId,
  });
  redirect(`${page}?generated=1`);
}

/** Publishes a draft version. */
export async function publishDraft(
  slug: string,
  versionId: ScheduleVersionId,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermission("schedule.manage", { next: page });
  const result = await publishVersion(txDb, versionId, subject.userId);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  const { moved, added, removed, teams } = result.value;
  redirect(
    `${page}?published=1&moved=${moved.length}&added=${added.length}&removed=${removed.length}&teams=${teams.length}`,
  );
}
