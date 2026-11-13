"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  approveNewTeamRequest,
  declineNewTeamRequest,
} from "@/db/queries/new-teams";
import { seasonForRegistration } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { parseId, type TeamFormationRequestId } from "@/domain/ids";
import { parseDeclineReason } from "@/domain/registration/new-team";
import { requirePermission } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { sendQueuedSoon } from "@/services/outbox";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/new-teams`;

async function context(slug: string, rawId: string) {
  const page = pageFor(slug);
  const subject = await requirePermission("team.approve_new", { next: page });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const requestId = parseId<TeamFormationRequestId>(rawId);
  if (!requestId) redirect(`${page}?error=not_found`);
  return { page, subject, league, season, requestId };
}

/** Approves a request: the team is created and the requester told. */
export async function approveNewTeamAction(
  slug: string,
  rawId: string,
): Promise<void> {
  const { page, subject, league, season, requestId } = await context(
    slug,
    rawId,
  );
  const result = await txDb.transaction((tx) =>
    approveNewTeamRequest(tx, {
      leagueId: league.id,
      season,
      requestId,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?notice=approved`);
}

/** Declines a request, with an optional reason the requester sees. */
export async function declineNewTeamAction(
  slug: string,
  rawId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season, requestId } = await context(slug, rawId);
  const reason = parseDeclineReason(formStrings(form, ["reason"]).reason);
  if (!reason.ok) redirect(`${page}?error=${reason.error}`);
  const result = await txDb.transaction((tx) =>
    declineNewTeamRequest(tx, {
      season,
      requestId,
      actorId: subject.userId,
      reason: reason.value,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?notice=declined`);
}
