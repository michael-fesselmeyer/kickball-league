"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { profileOf } from "@/db/queries/profile";
import {
  registerFreeAgent,
  registerTeam,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { recordOf } from "@/domain/guards";
import { parseId, type TeamId } from "@/domain/ids";
import { parseProfileForm, toProfileForm } from "@/domain/profile/profile-form";
import { localDate } from "@/domain/scheduler/slots";
import { requirePermissionToChange } from "@/lib/auth/permission";

export type RegisterState = {
  values: Record<string, string>;
  error?: string | undefined;
};

const MESSAGES: Record<string, string> = {
  closed: "Registration for this season is not open.",
  already_registered: "You are already registered for this season.",
  no_price: "The league has not set a price for this yet.",
  season_full:
    "The season is full. Join as a free agent and we will place you.",
  bad_name: "Give your team a name of up to 40 characters.",
  name_taken:
    "That team name is taken. If it was your team, choose it from your past teams.",
  bad_roster_size: "Pick a roster size within the season's limits.",
  bad_color: "Pick a team color.",
  profile_incomplete: "Finish your profile before registering.",
};

/** Loads what both actions need and checks the person may register. */
async function context(slug: string) {
  const page = `/app/seasons/${slug}/register`;
  const subject = await requirePermissionToChange("team.register", {
    next: page,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const person = await profileOf(db, subject.userId);
  const today = localDate(new Date(), league.timeZone);
  const complete =
    person !== null && parseProfileForm(toProfileForm(person), today).ok;
  return { subject, league, season, complete };
}

const TEAM_FIELDS = [
  "teamId",
  "name",
  "colorHex",
  "paymentMode",
  "rosterSize",
] as const;

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

export async function registerTeamAction(
  slug: string,
  _previous: RegisterState,
  form: FormData,
): Promise<RegisterState> {
  const { subject, league, season, complete } = await context(slug);
  const values = recordOf(TEAM_FIELDS, (k) => text(form, k));
  if (!complete) return { values, error: MESSAGES.profile_incomplete };
  const teamId = values.teamId ? parseId<TeamId>(values.teamId) : null;
  if (values.teamId && !teamId) return { values, error: MESSAGES.bad_name };
  const result = await txDb.transaction((tx) =>
    registerTeam(tx, {
      leagueId: league.id,
      season,
      userId: subject.userId,
      team: {
        teamId,
        name: values.name,
        colorHex: values.colorHex || null,
        paymentMode: values.paymentMode === "full" ? "full" : "split",
        rosterSize: Number(values.rosterSize),
      },
      now: new Date(),
    }),
  );
  if (!result.ok) return { values, error: MESSAGES[result.error] };
  redirect(`/app/seasons/${slug}?registered=team`);
}

export async function registerFreeAgentAction(
  slug: string,
  previous: RegisterState,
): Promise<RegisterState> {
  const { subject, season, complete } = await context(slug);
  if (!complete) return { ...previous, error: MESSAGES.profile_incomplete };
  const result = await txDb.transaction((tx) =>
    registerFreeAgent(tx, { season, userId: subject.userId, now: new Date() }),
  );
  if (!result.ok) return { ...previous, error: MESSAGES[result.error] };
  redirect(`/app/seasons/${slug}?registered=free_agent`);
}
