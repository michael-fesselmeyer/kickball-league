"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { saveChecklist } from "@/db/queries/game-day-checklist";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseChecklistForm } from "@/domain/gameday/checklist";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";

/**
 * An admin saves a season's game-day checklist and move script (issue
 * #409). Items whose words stay keep the ticks they already have.
 */
export async function saveChecklistAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = `/app/admin/seasons/${slug}/game-day-checklist`;
  const subject = await requirePermissionToChange("game_checklist.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const parsed = parseChecklistForm(form);
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}`);
  else {
    await txDb.transaction((tx) =>
      saveChecklist(tx, {
        seasonId: season.id,
        form: parsed.value,
        actorId: subject.userId,
      }),
    );
    redirect(`${page}?notice=saved`);
  }
}
