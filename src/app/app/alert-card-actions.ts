"use server";

import { headers } from "next/headers";
import { txDb } from "@/db/client";
import { answerAlertCard } from "@/db/queries/alert-choices";
import { savePushSubscription } from "@/db/queries/push";
import { ALERT_CARDS, type AlertCard } from "@/domain/notifications/alert-cards";
import { parseDeviceSubscription } from "@/domain/notifications/push";
import { parseId, type UserId } from "@/domain/ids";
import { requireSelfToChange } from "@/lib/auth/permission";

export type AlertCardState = {
  status: "idle" | "yes" | "email_instead" | "no" | "error";
};

const isCard = (v: unknown): v is AlertCard =>
  typeof v === "string" && (ALERT_CARDS as readonly string[]).includes(v);

/**
 * An answer to an alert card (issue #529). "Yes" on a push card comes with
 * the device the browser just subscribed; without one (`push_failed`), the
 * same alerts come by email instead.
 */
export async function answerAlertCardAction(
  _previous: AlertCardState,
  form: FormData,
): Promise<AlertCardState> {
  const subject = await requireSelfToChange("profile.edit", "/app");
  const userId = parseId<UserId>(subject.userId);
  const card = form.get("card");
  const answer = form.get("answer");
  if (!userId || !isCard(card) || (answer !== "yes" && answer !== "no"))
    return { status: "error" };
  const raw = form.get("subscription");
  const device =
    typeof raw === "string" && raw !== ""
      ? parseDeviceSubscription(raw, (await headers()).get("user-agent"))
      : null;
  const pushFailed = form.get("push_failed") === "1";
  if (answer === "yes" && typeof raw === "string" && raw !== "" && !device)
    return { status: "error" };
  const now = new Date();
  await txDb.transaction(async (tx) => {
    if (device) await savePushSubscription(tx, userId, device);
    await answerAlertCard(tx, userId, card, answer, { now, pushFailed });
  });
  if (answer === "no") return { status: "no" };
  return { status: pushFailed ? "email_instead" : "yes" };
}
