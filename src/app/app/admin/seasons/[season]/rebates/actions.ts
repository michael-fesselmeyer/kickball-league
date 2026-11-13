"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { issueRebate } from "@/db/queries/rebates";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { parseId, type TeamSeasonId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";

/**
 * Issues a team's rain-out rebate as league credit to everyone who paid
 * toward it (refund.issue: "Issue a refund or league credit").
 */
export async function issueRebateAction(
  slug: string,
  teamSeasonId: string,
): Promise<void> {
  const page = `/app/admin/seasons/${slug}/rebates`;
  const subject = await requirePermissionToChange("refund.issue", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  const team = parseId<TeamSeasonId>(teamSeasonId);
  if (!season || !team) notFound();
  const actorId = subject.userId;
  const result = await txDb.transaction((tx) =>
    issueRebate(tx, {
      seasonId: season.id,
      teamSeasonId: team,
      actorId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?notice=issued`);
}
