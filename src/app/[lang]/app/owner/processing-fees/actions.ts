"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { saveFeeSettings } from "@/db/queries/processing-fees";
import { parseFeeSettings } from "@/domain/money/processing-fee";
import {
  requirePermissionToChange,
  sessionIsFresh,
} from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

const PAGE = "/app/owner/processing-fees";

/**
 * Saves who covers processing fees (ADR 0093). Changing it needs a sign-in
 * from the last few minutes, like other payment settings, and turning it on
 * needs the owner's tick that the league has done what the ADR lists.
 */
export async function saveFeeSettingsAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("processing_fees.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  if (!(await sessionIsFresh())) redirect(`${PAGE}?error=stale`);
  const parsed = parseFeeSettings((name) => form.get(name));
  if (!parsed.ok) redirect(`${PAGE}?error=${parsed.error}`);
  if (parsed.value.mode !== "off" && form.get("confirmed") !== "on")
    redirect(`${PAGE}?error=unconfirmed`);
  await txDb.transaction((tx) =>
    saveFeeSettings(tx, {
      leagueId: league.id,
      actorId: subject.userId,
      settings: parsed.value,
    }),
  );
  redirect(`${PAGE}?notice=saved`);
}
