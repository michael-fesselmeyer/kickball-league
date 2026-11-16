"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  checkInTeam,
  closeByLeague,
  openCheckIns,
  pauseCheckIn,
  resumeCheckIn,
  setLeadershipQuorum,
} from "@/db/queries/leadership";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { type LeadershipCheckInId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";

/**
 * Admins run the season-end leadership check-in (ADR 0077): open it for
 * every team, set the league's quorum, and pause, resume or close one
 * team's. None of these sees or changes a choice.
 */

const pageOf = (slug: string, code: string) =>
  `/app/admin/seasons/${slug}/leadership?leadership=${code}`;

async function guard(slug: string) {
  const subject = await requirePermissionToChange("leadership.manage", {
    next: `/app/admin/seasons/${slug}/leadership`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  return { subject, season };
}

/** A check-in of this season, or a 404. */
async function ownCheckIn(seasonId: string, raw: string) {
  const checkInId = parseId<LeadershipCheckInId>(raw);
  if (!checkInId) notFound();
  const found = await checkInTeam(db, checkInId);
  if (!found || found.seasonId !== seasonId) notFound();
  return checkInId;
}

export async function openCheckInsAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const days = Number(form.get("days"));
  const result = await txDb.transaction((tx) =>
    openCheckIns(tx, {
      seasonId: season.id,
      days,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  redirect(pageOf(slug, result.ok ? "opened" : result.error));
}

export async function setQuorumAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { subject, season } = await guard(slug);
  const result = await txDb.transaction((tx) =>
    setLeadershipQuorum(tx, {
      leagueId: season.leagueId,
      percent: Number(form.get("percent")),
      actorId: subject.userId,
    }),
  );
  redirect(pageOf(slug, result.ok ? "quorum_saved" : result.error));
}

export async function pauseAction(slug: string, raw: string): Promise<void> {
  const { subject, season } = await guard(slug);
  const checkInId = await ownCheckIn(season.id, raw);
  const result = await txDb.transaction((tx) =>
    pauseCheckIn(tx, { checkInId, actorId: subject.userId, now: new Date() }),
  );
  redirect(pageOf(slug, result.ok ? "paused_now" : result.error));
}

export async function resumeAction(slug: string, raw: string): Promise<void> {
  const { subject, season } = await guard(slug);
  const checkInId = await ownCheckIn(season.id, raw);
  const result = await txDb.transaction((tx) =>
    resumeCheckIn(tx, { checkInId, actorId: subject.userId, now: new Date() }),
  );
  redirect(pageOf(slug, result.ok ? "resumed" : result.error));
}

export async function closeAction(slug: string, raw: string): Promise<void> {
  const { subject, season } = await guard(slug);
  const checkInId = await ownCheckIn(season.id, raw);
  const result = await txDb.transaction((tx) =>
    closeByLeague(tx, { checkInId, actorId: subject.userId, now: new Date() }),
  );
  redirect(pageOf(slug, result.ok ? "closed_now" : result.error));
}
