"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { confirmChallengeWinner, saveChallenge } from "@/db/queries/challenges";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseChallengeForm } from "@/domain/drive/challenge";
import { parseId, type TeamSeasonId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/challenge`;

/** Starts the season's sign-up challenge, or changes its prize or deadline. */
export async function saveChallengeAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("challenge.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const parsed = parseChallengeForm(
    formStrings(form, ["prize", "deadlineOn", "deadlineTime"] as const),
    season.timeZone,
  );
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}`);
  const saved = await txDb.transaction((tx) =>
    saveChallenge(tx, {
      seasonId: season.id,
      challenge: parsed.value,
      actorId: subject.userId,
    }),
  );
  if (!saved.ok) redirect(`${page}?error=${saved.error}`);
  redirect(`${page}?saved=${saved.value}`);
}

/** Confirms the team at the top of the board as the winner. */
export async function confirmWinnerAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageOf(slug);
  const subject = await requirePermissionToChange("challenge.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  const teamSeasonId = parseId<TeamSeasonId>(form.get("team"));
  if (!season || !teamSeasonId) notFound();
  const confirmed = await txDb.transaction((tx) =>
    confirmChallengeWinner(tx, {
      seasonId: season.id,
      teamSeasonId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!confirmed.ok) redirect(`${page}?error=${confirmed.error}`);
  redirect(`${page}?saved=confirmed`);
}
