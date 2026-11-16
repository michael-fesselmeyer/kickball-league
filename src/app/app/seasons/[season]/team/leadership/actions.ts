"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  answerSuggestion,
  captainChooses,
  castVote,
  checkInTeam,
  submitCheckIn,
} from "@/db/queries/leadership";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { can } from "@/domain/authz/permissions";
import {
  type LeadershipCheckInId,
  type LeadershipOptionId,
  parseId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import type { LeadRole } from "@/domain/leadership/leadership";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

/**
 * The season-end leadership check-in (ADR 0090). Every action is about the
 * person's own team this season; none logs what was chosen.
 */

const pageOf = (slug: string, code: string) =>
  `/app/seasons/${slug}/team/leadership?leadership=${code}`;

/** The person's own team this season and its check-in, or a 404. */
async function context(slug: string, rawCheckInId: string) {
  const page = `/app/seasons/${slug}/team/leadership`;
  const subject = await requirePermissionToChange("registration.join", {
    next: page,
  });
  const league = await activeLeague();
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId: TeamSeasonId | undefined = mine?.team?.teamSeasonId;
  const checkInId = parseId<LeadershipCheckInId>(rawCheckInId);
  if (!teamSeasonId || !checkInId) notFound();
  const found = await checkInTeam(db, checkInId);
  if (!found || found.teamSeasonId !== teamSeasonId) notFound();
  return { subject, teamSeasonId, checkInId };
}

const isRole = (value: unknown): value is LeadRole =>
  value === "captain" || value === "co_captain";

/** A player's one, private check-in. */
export async function checkInAction(
  slug: string,
  rawCheckInId: string,
  form: FormData,
): Promise<void> {
  const { subject, teamSeasonId, checkInId } = await context(
    slug,
    rawCheckInId,
  );
  if (!can(subject, "leadership.take_part", { teamSeasonId })) notFound();
  const volunteer = form.getAll("volunteer").filter(isRole);
  const suggestTo = parseId<UserId>(form.get("suggest"));
  const suggestRole = form.get("suggestRole");
  const suggest =
    suggestTo && isRole(suggestRole)
      ? { userId: suggestTo, role: suggestRole }
      : null;
  const result = await txDb.transaction((tx) =>
    submitCheckIn(tx, {
      checkInId,
      userId: subject.userId,
      choice: {
        volunteer,
        suggest,
        steppingDown: form.get("steppingDown") === "yes",
      },
      now: new Date(),
    }),
  );
  redirect(pageOf(slug, result.ok ? "checked_in" : result.error));
}

/** A suggested teammate's answer, or a volunteer withdrawing. */
export async function answerAction(
  slug: string,
  rawCheckInId: string,
  role: LeadRole,
  accept: boolean,
): Promise<void> {
  const { subject, teamSeasonId, checkInId } = await context(
    slug,
    rawCheckInId,
  );
  if (!can(subject, "leadership.take_part", { teamSeasonId })) notFound();
  const result = await txDb.transaction((tx) =>
    answerSuggestion(tx, {
      checkInId,
      userId: subject.userId,
      role,
      accept,
      now: new Date(),
    }),
  );
  redirect(
    pageOf(
      slug,
      result.ok ? (accept ? "standing" : "not_standing") : result.error,
    ),
  );
}

/** A secret vote. */
export async function voteAction(
  slug: string,
  rawCheckInId: string,
  form: FormData,
): Promise<void> {
  const { subject, teamSeasonId, checkInId } = await context(
    slug,
    rawCheckInId,
  );
  if (!can(subject, "leadership.take_part", { teamSeasonId })) notFound();
  const optionId = parseId<LeadershipOptionId>(form.get("option"));
  if (!optionId) redirect(pageOf(slug, "pick_one"));
  const result = await txDb.transaction((tx) =>
    castVote(tx, {
      checkInId,
      userId: subject.userId,
      optionId,
      now: new Date(),
    }),
  );
  redirect(pageOf(slug, result.ok ? "voted" : result.error));
}

/** The captain's private choice after the ballot chose a teammate. */
export async function chooseAction(
  slug: string,
  rawCheckInId: string,
  choice: "hand_off_now" | "captain_elect",
): Promise<void> {
  const { subject, teamSeasonId, checkInId } = await context(
    slug,
    rawCheckInId,
  );
  if (!can(subject, "leadership.choose", { teamSeasonId })) notFound();
  const result = await txDb.transaction((tx) =>
    captainChooses(tx, {
      checkInId,
      userId: subject.userId,
      choice,
      now: new Date(),
    }),
  );
  redirect(pageOf(slug, result.ok ? choice : result.error));
}
