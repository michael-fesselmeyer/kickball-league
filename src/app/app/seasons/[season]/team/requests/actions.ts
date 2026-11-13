"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import {
  addTeamRequest,
  removeTeamRequest,
  requestCount,
  seasonGameTimes,
} from "@/db/queries/team-requests";
import { can, type Subject } from "@/domain/authz/permissions";
import type { TeamConstraintId } from "@/domain/ids";
import {
  parseTeamRequest,
  requestsOpen,
} from "@/domain/schedule/team-requests";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";

const isAdmin = (s: Subject) =>
  s.globalRole === "admin" || s.globalRole === "owner";

/** The captain's team for the season, or not found; and whether they may still change requests. */
async function captainsTeam(slug: string) {
  const page = `/app/seasons/${slug}/team/requests`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const team = (await myRegistration(db, season.id, subject.userId))?.team;
  if (
    !team ||
    !can(subject, "conflicts.submit", { teamSeasonId: team.teamSeasonId })
  )
    notFound();
  const open = isAdmin(subject) || requestsOpen(season, new Date());
  return { page, subject, league, season, team, open };
}

/** A captain or co-captain adds a conflict or preference for their team. */
export async function addTeamRequestAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, league, season, team, open } =
    await captainsTeam(slug);
  if (!open) redirect(`${page}?error=closed`);
  const times = await seasonGameTimes(db, season.id, league.timeZone);
  const parsed = parseTeamRequest(
    formStrings(form, ["kind", "onDate", "timeIndex", "reason"] as const),
    {
      startsOn: season.startsOn,
      endsOn: season.endsOn,
      timeIndexes: times.map((t) => t.timeIndex),
    },
    await requestCount(db, team.teamSeasonId),
  );
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}`);
  const saved = await txDb.transaction((tx) =>
    addTeamRequest(tx, {
      teamSeasonId: team.teamSeasonId,
      request: parsed.value,
      actorId: subject.userId,
    }),
  );
  if (!saved.ok) redirect(`${page}?error=${saved.error}`);
  redirect(`${page}?saved=1`);
}

/** A captain or co-captain removes one of their team's requests. */
export async function removeTeamRequestAction(
  slug: string,
  id: TeamConstraintId,
): Promise<void> {
  const { page, subject, team, open } = await captainsTeam(slug);
  if (!open) redirect(`${page}?error=closed`);
  const removed = await txDb.transaction((tx) =>
    removeTeamRequest(tx, {
      id,
      teamSeasonId: team.teamSeasonId,
      actorId: subject.userId,
    }),
  );
  redirect(removed.ok ? `${page}?removed=1` : `${page}?error=not_found`);
}
