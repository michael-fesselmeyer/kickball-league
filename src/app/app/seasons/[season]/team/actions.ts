"use server";

import { notFound } from "next/navigation";
import { db, txDb } from "@/db/client";
import { createTeamInvite } from "@/db/queries/invites";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import type { TeamSeasonId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";

export type InviteState = { token?: string; expiresAt?: string };

/**
 * Makes a new team link for the captain's own team. The token comes back to
 * the page once, never in a URL the server logs.
 */
export async function createInviteAction(
  slug: string,
  previous: InviteState,
): Promise<InviteState> {
  const subject = await requirePermission("registration.join", {
    next: `/app/seasons/${slug}/team`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId as TeamSeasonId | undefined;
  if (
    !teamSeasonId ||
    !can(subject, "roster.manage", { teamSeasonId, targetRole: "player" })
  )
    notFound();
  const userId = subject.userId;
  const created = await txDb.transaction((tx) =>
    createTeamInvite(tx, { teamSeasonId, actorId: userId, now: new Date() }),
  );
  return {
    ...previous,
    token: created.token,
    expiresAt: created.expiresAt.toISOString(),
  };
}
