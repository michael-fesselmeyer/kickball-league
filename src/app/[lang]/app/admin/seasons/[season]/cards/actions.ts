"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { activeLeagueId } from "@/lib/league/active";
import { buildSeasonCards } from "@/db/queries/season-cards";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshSeasonCards } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

const pageOf = (slug: string) => `/app/admin/seasons/${slug}/cards`;

/**
 * Builds every player's card for a completed season, or refreshes them,
 * and tells each player once that theirs is ready.
 */
export async function buildSeasonCardsAction(slug: string): Promise<void> {
  const subject = await requirePermissionToChange("season.manage", {
    next: pageOf(slug),
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const result = await buildSeasonCards(txDb, {
    seasonId: season.id,
    actorId: subject.userId,
    now: new Date(),
  });
  if (!result.ok) redirect(`${pageOf(slug)}?error=${result.error}`);
  refreshSeasonCards({ seasonId: season.id });
  if (result.value.told > 0) sendQueuedSoon();
  redirect(
    `${pageOf(slug)}?built=${result.value.cards}&told=${result.value.told}`,
  );
}
