"use server";

import { redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { setLeaderboardOptOut } from "@/db/queries/stat-awards";
import { requireSelfToChange } from "@/lib/auth/permission";
import { refreshSeasonPages } from "@/lib/public-cache";

/**
 * Takes the person off public stat leaderboards, or puts them back. The
 * awards pages that listed them refresh at once.
 */
export async function setOptOutAction(optOut: boolean): Promise<void> {
  const subject = await requireSelfToChange("profile.edit", "/app/stats");
  const seasons = await setLeaderboardOptOut(txDb, subject.userId, optOut);
  for (const seasonId of seasons) refreshSeasonPages(seasonId);
  redirect(`/app/stats?saved=${optOut ? "hidden" : "shown"}`);
}
