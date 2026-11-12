"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { saveProfile } from "@/db/queries/profile";
import { currentLeague } from "@/db/queries/seasons";
import {
  PROFILE_FIELDS,
  type ProfileErrors,
  type ProfileForm,
  parseProfileForm,
} from "@/domain/profile/profile-form";
import { localDate } from "@/domain/scheduler/slots";
import { requireSelf } from "@/lib/auth/permission";

export type ProfileFormState = {
  values: ProfileForm;
  errors: ProfileErrors;
  message?: string | undefined;
};

/** Saves the signed-in person's own profile. */
export async function saveProfileAction(
  _previous: ProfileFormState,
  form: FormData,
): Promise<ProfileFormState> {
  const subject = await requireSelf("profile.edit", "/app/profile");
  const league = await currentLeague(db);
  if (!league) notFound();
  const values = Object.fromEntries(
    PROFILE_FIELDS.map((k) => {
      const v = form.get(k);
      return [k, typeof v === "string" ? v : ""];
    }),
  ) as ProfileForm;
  // Ages are checked against today in the league's time zone.
  const today = localDate(new Date(), league.timeZone);
  const parsed = parseProfileForm(values, today);
  if (!parsed.ok)
    return {
      values,
      errors: parsed.errors,
      message: "Check the fields marked below.",
    };
  await txDb.transaction((tx) => saveProfile(tx, subject.userId, parsed.value));
  redirect("/app/profile?saved=1");
}
