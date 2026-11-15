"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { profileOf } from "@/db/queries/profile";
import { recordReferral } from "@/db/queries/referrals";
import {
  registerFreeAgent,
  registerTeam,
  seasonForRegistration,
} from "@/db/queries/registration";
import { saveShirtSize, shirtSettings } from "@/db/queries/shirt-order";
import { recordOf } from "@/domain/guards";
import {
  parseId,
  type RegistrationId,
  type SeasonId,
  type TeamId,
  type UserId,
} from "@/domain/ids";
import {
  normalizeReferralCode,
  REFERRAL_COOKIE,
} from "@/domain/money/referral";
import { readyToRegister } from "@/domain/profile/profile-form";
import { ageMessage } from "@/domain/registration/age";
import { localDate } from "@/domain/scheduler/slots";
import { pickSize } from "@/domain/shirts/order";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { mayRegister } from "@/lib/private-events/invite";

export type RegisterState = {
  values: Record<string, string>;
  error?: string | undefined;
};

const MESSAGES: Record<string, string> = {
  closed: "Registration for this season isn't open.",
  already_registered: "You're already registered for this season.",
  no_price: "The league hasn't set a price yet.",
  season_full:
    "The season is full. Join the waitlist below, or join as a free agent and we will place you.",
  bad_name: "Give your team a name of up to 40 characters.",
  name_taken:
    "That team name is taken. If it was your team, choose it from your past teams.",
  bad_roster_size: "Pick a roster size within the season's limits.",
  bad_color: "Pick a team color.",
  profile_incomplete: "Finish your profile before registering.",
  shirt_size: "Pick your shirt size.",
};

/** The message for an error code, with the season's minimum age. */
function messageFor(error: string, minimumAge: number): string | undefined {
  return error === "age_unconfirmed" || error === "under_age"
    ? ageMessage(error, minimumAge)
    : MESSAGES[error];
}

/** Loads what both actions need and checks the person may register. */
async function context(slug: string) {
  const page = `/app/seasons/${slug}/register`;
  const subject = await requirePermissionToChange("team.register", {
    next: page,
  });
  const league = await activeLeague();
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season || !(await mayRegister(season))) notFound();
  const person = await profileOf(db, subject.userId);
  const today = localDate(new Date(), league.timeZone);
  const complete = person !== null && readyToRegister(person, today);
  const { sizes } = await shirtSettings(db, season.id);
  return { subject, league, season, complete, sizes };
}

/** The referral link this person arrived through, if any. */
async function referralCode(): Promise<string | null> {
  const jar = await cookies();
  return normalizeReferralCode(jar.get(REFERRAL_COOKIE)?.value);
}

/**
 * Counts a first registration toward the referral that brought the person,
 * then forgets the link. Never stops the registration.
 */
async function creditReferral(
  tx: Parameters<Parameters<typeof txDb.transaction>[0]>[0],
  code: string | null,
  input: { userId: UserId; seasonId: SeasonId; registrationId: RegistrationId },
) {
  if (!code) return;
  await recordReferral(tx, {
    code,
    referredUserId: input.userId,
    seasonId: input.seasonId,
    registrationId: input.registrationId,
  });
}

const TEAM_FIELDS = [
  "shirtSize",
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
  const { subject, league, season, complete, sizes } = await context(slug);
  const values = recordOf(TEAM_FIELDS, (k) => text(form, k));
  if (!complete) return { values, error: MESSAGES.profile_incomplete };
  const shirtSize = pickSize(values.shirtSize, sizes);
  if (!shirtSize) return { values, error: MESSAGES.shirt_size };
  const teamId = values.teamId ? parseId<TeamId>(values.teamId) : null;
  if (values.teamId && !teamId) return { values, error: MESSAGES.bad_name };
  const code = await referralCode();
  const userId = subject.userId;
  const result = await txDb.transaction(async (tx) => {
    const registered = await registerTeam(tx, {
      leagueId: league.id,
      season,
      userId,
      team: {
        teamId,
        name: values.name,
        colorHex: values.colorHex || null,
        paymentMode: values.paymentMode === "full" ? "full" : "split",
        rosterSize: Number(values.rosterSize),
      },
      ageConfirmed: form.get("ageConfirmed") === "yes",
      now: new Date(),
    });
    if (registered.ok) {
      await saveShirtSize(tx, { userId, size: shirtSize });
      await creditReferral(tx, code, {
        userId,
        seasonId: season.id,
        registrationId: registered.value.registrationId,
      });
    }
    return registered;
  });
  // A second tap, or a resend, finds the first one's registration: show it.
  if (!result.ok && result.error === "already_registered")
    redirect(`/app/seasons/${slug}`);
  if (!result.ok)
    return { values, error: messageFor(result.error, season.minimumAge) };
  if (code) (await cookies()).delete(REFERRAL_COOKIE);
  redirect(`/app/seasons/${slug}?registered=team`);
}

export async function registerFreeAgentAction(
  slug: string,
  previous: RegisterState,
  form: FormData,
): Promise<RegisterState> {
  const { subject, season, complete, sizes } = await context(slug);
  // A private event takes whole teams, not free agents.
  if (season.visibility === "private") notFound();
  if (!complete) return { ...previous, error: MESSAGES.profile_incomplete };
  const shirtSize = pickSize(text(form, "shirtSize"), sizes);
  if (!shirtSize)
    return {
      values: { shirtSize: text(form, "shirtSize") },
      error: MESSAGES.shirt_size,
    };
  const code = await referralCode();
  const userId = subject.userId;
  const result = await txDb.transaction(async (tx) => {
    const registered = await registerFreeAgent(tx, {
      season,
      userId,
      ageConfirmed: form.get("ageConfirmed") === "yes",
      now: new Date(),
    });
    if (registered.ok) {
      await saveShirtSize(tx, { userId, size: shirtSize });
      await creditReferral(tx, code, {
        userId,
        seasonId: season.id,
        registrationId: registered.value,
      });
    }
    return registered;
  });
  if (!result.ok && result.error === "already_registered")
    redirect(`/app/seasons/${slug}`);
  if (!result.ok)
    return {
      ...previous,
      error: messageFor(result.error, season.minimumAge),
    };
  if (code) (await cookies()).delete(REFERRAL_COOKIE);
  redirect(`/app/seasons/${slug}?registered=free_agent`);
}
