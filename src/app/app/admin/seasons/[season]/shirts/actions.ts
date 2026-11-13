"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { markTeamOrdered, setShirtStatus } from "@/db/queries/shirts";
import { parseId, type RegistrationId, type TeamSeasonId } from "@/domain/ids";
import { isShirtStatus } from "@/domain/shirts/summary";
import { requirePermissionToChange } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/shirts`;

/** Sets one player's shirt to not ordered, ordered or received. */
export async function setShirtStatusAction(
  slug: string,
  rawRegistrationId: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("shirts.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const registrationId = parseId<RegistrationId>(rawRegistrationId);
  const status = form.get("status");
  if (!registrationId || !isShirtStatus(status))
    redirect(`${page}?error=unknown`);
  const result = await txDb.transaction((tx) =>
    setShirtStatus(tx, {
      seasonId: season.id,
      registrationId,
      status,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=unknown`);
  redirect(`${page}?notice=saved#player-${registrationId}`);
}

/** Marks every shirt on a team that is not ordered yet as ordered. */
export async function markTeamOrderedAction(
  slug: string,
  rawTeamSeasonId: string,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("shirts.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const teamSeasonId = parseId<TeamSeasonId>(rawTeamSeasonId);
  if (!teamSeasonId) redirect(`${page}?error=unknown`);
  await txDb.transaction((tx) =>
    markTeamOrdered(tx, {
      seasonId: season.id,
      teamSeasonId,
      actorId: subject.userId,
    }),
  );
  redirect(`${page}?notice=ordered#team-${teamSeasonId}`);
}
