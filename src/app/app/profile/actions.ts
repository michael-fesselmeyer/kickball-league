"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { saveAlertLimits, saveEmailSettings } from "@/db/queries/notifications";
import {
  countPushDevices,
  removePushSubscription,
  savePushSettings,
  savePushSubscription,
} from "@/db/queries/push";
import {
  ALERT_LIMIT_FIELDS,
  alertLimitsForm,
} from "@/domain/notifications/limits";
import { parseDeviceSubscription } from "@/domain/notifications/push";
import { saveProfile } from "@/db/queries/profile";
import { currentLeague } from "@/db/queries/seasons";
import {
  PROFILE_FIELDS,
  type ProfileErrors,
  type ProfileForm,
  parseProfileForm,
} from "@/domain/profile/profile-form";
import { localDate } from "@/domain/scheduler/slots";
import { requireSelfToChange } from "@/lib/auth/permission";
import { env } from "@/env";
import { formStrings } from "@/lib/form";

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
  const subject = await requireSelfToChange("profile.edit", "/app/profile");
  const league = await currentLeague(db);
  if (!league) notFound();
  const values: ProfileForm = formStrings(form, PROFILE_FIELDS);
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

/** Saves which topics the signed-in person gets email about. */
export async function saveEmailSettingsAction(form: FormData): Promise<void> {
  const subject = await requireSelfToChange("profile.edit", "/app/profile");
  const enabled = new Set(
    form.getAll("topic").filter((v): v is string => typeof v === "string"),
  );
  await txDb.transaction((tx) =>
    saveEmailSettings(tx, subject.userId, enabled),
  );
  redirect("/app/profile?emails=saved#notifications");
}

/**
 * Saves the signed-in person's daily cap, digest and quiet hours. Messages
 * already held move to the next digest under the new choice.
 */
export async function saveAlertLimitsAction(form: FormData): Promise<void> {
  const subject = await requireSelfToChange("profile.edit", "/app/profile");
  const parsed = alertLimitsForm.safeParse(
    formStrings(form, ALERT_LIMIT_FIELDS),
  );
  if (!parsed.success) redirect("/app/profile?alerts=invalid#alert-limits");
  const league = await currentLeague(db);
  if (!league) notFound();
  const now = new Date();
  await txDb.transaction((tx) =>
    saveAlertLimits(tx, subject.userId, parsed.data, {
      now,
      timeZone: league.timeZone,
    }),
  );
  redirect("/app/profile?alerts=saved#alert-limits");
}

export type PushSettingsState = {
  status: "idle" | "saved" | "error";
  message?: string;
  /** How many devices get the person's pushes now, after the change. */
  devices?: number;
};

/**
 * Saves which topics the signed-in person gets pushes about and, when the
 * page subscribed this device, remembers the device. Both in one
 * transaction, so a saved choice always has the device it was made on.
 */
export async function savePushSettingsAction(
  _previous: PushSettingsState,
  form: FormData,
): Promise<PushSettingsState> {
  const subject = await requireSelfToChange("profile.edit", "/app/profile");
  if (!env.VAPID_PUBLIC_KEY)
    return { status: "error", message: "Push isn't set up for the league." };
  const enabled = new Set(
    form.getAll("topic").filter((v): v is string => typeof v === "string"),
  );
  const raw = form.get("subscription");
  const device =
    raw === null || raw === ""
      ? null
      : parseDeviceSubscription(raw, (await headers()).get("user-agent"));
  if (raw !== null && raw !== "" && !device)
    return {
      status: "error",
      message: "This browser sent a subscription we can't use. Try again.",
    };
  const devices = await txDb.transaction(async (tx) => {
    if (device) await savePushSubscription(tx, subject.userId, device);
    await savePushSettings(tx, subject.userId, enabled);
    return countPushDevices(tx, subject.userId);
  });
  return { status: "saved", message: "Push settings saved.", devices };
}

/** Forgets this device, after the page has unsubscribed it in the browser. */
export async function forgetPushDeviceAction(
  _previous: PushSettingsState,
  form: FormData,
): Promise<PushSettingsState> {
  const subject = await requireSelfToChange("profile.edit", "/app/profile");
  const endpoint = form.get("endpoint");
  if (typeof endpoint === "string" && endpoint.length <= 2048)
    await removePushSubscription(db, subject.userId, endpoint);
  return {
    status: "saved",
    message: "Push is off on this device.",
    devices: await countPushDevices(db, subject.userId),
  };
}
