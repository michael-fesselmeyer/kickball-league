"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { requestNewTeam, withdrawNewTeamRequest } from "@/db/queries/new-teams";
import { profileOf } from "@/db/queries/profile";
import { seasonForRegistration } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { parseId, type TeamFormationRequestId } from "@/domain/ids";
import { parseProfileForm, toProfileForm } from "@/domain/profile/profile-form";
import { parseNewTeamRequest } from "@/domain/registration/new-team";
import { localDate } from "@/domain/scheduler/slots";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";

export type NewTeamState = {
  values: Record<string, string>;
  error?: string | undefined;
};

const MESSAGES: Record<string, string> = {
  bad_name: "Give the team a name of up to 40 characters.",
  bad_size: "Pick a team size within the season's roster limits.",
  note_too_long: "Keep the note to 500 characters.",
  closed: "Registration for this season is not open.",
  captain:
    "You already captain a team this season. Hand it to someone else first.",
  pending: "You already have a request waiting for the league.",
  name_taken: "That team name is taken. Try another.",
  profile_incomplete: "Finish your profile before asking for a team.",
};

const FIELDS = ["name", "expectedSize", "paymentMode", "note"] as const;

const pageFor = (slug: string) => `/app/seasons/${slug}/new-team`;

async function context(slug: string) {
  const subject = await requirePermissionToChange("team.request_new", {
    next: pageFor(slug),
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  return { subject, league, season };
}

/** A signed-in player asks the league to start a team this season. */
export async function requestNewTeamAction(
  slug: string,
  _previous: NewTeamState,
  form: FormData,
): Promise<NewTeamState> {
  const { subject, league, season } = await context(slug);
  const values = formStrings(form, FIELDS);
  // Approval may register them, which needs the same details as registering.
  const person = await profileOf(db, subject.userId);
  const today = localDate(new Date(), league.timeZone);
  if (person === null || !parseProfileForm(toProfileForm(person), today).ok)
    return { values, error: MESSAGES.profile_incomplete };
  const parsed = parseNewTeamRequest(values, season);
  if (!parsed.ok) return { values, error: MESSAGES[parsed.error] };
  const result = await txDb.transaction((tx) =>
    requestNewTeam(tx, {
      leagueId: league.id,
      season,
      userId: subject.userId,
      request: parsed.value,
      now: new Date(),
    }),
  );
  if (!result.ok) return { values, error: MESSAGES[result.error] };
  redirect(`${pageFor(slug)}?sent=1`);
}

/** The requester takes back a request the league has not answered. */
export async function withdrawNewTeamAction(
  slug: string,
  rawId: string,
): Promise<void> {
  const { subject } = await context(slug);
  const requestId = parseId<TeamFormationRequestId>(rawId);
  if (!requestId) notFound();
  const result = await txDb.transaction((tx) =>
    withdrawNewTeamRequest(tx, { requestId, userId: subject.userId }),
  );
  redirect(
    `${pageFor(slug)}?${result.ok ? "withdrawn=1" : "error=not_pending"}`,
  );
}
