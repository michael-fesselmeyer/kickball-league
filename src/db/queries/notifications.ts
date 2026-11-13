import { and, eq } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import { type AlertLimits, nextDigestAt } from "@/domain/notifications/limits";
import {
  type Choice,
  SETTINGS_TOPICS,
  wantsEmail,
} from "@/domain/notifications/topics";
import {
  alertSetting,
  message,
  notificationPreference,
} from "../schema/message";
import { alertLimitsOf } from "./outbox";
import { required } from "./rows";
import type { Db } from "./schedule";

/** The email settings page: each offered topic, on or off for this person. */
export async function emailSettingsOf(db: Db, userId: UserId) {
  const choices: Choice[] = await db
    .select({
      topic: notificationPreference.topic,
      enabled: notificationPreference.enabled,
    })
    .from(notificationPreference)
    .where(
      and(
        eq(notificationPreference.userId, userId),
        eq(notificationPreference.channel, "email"),
      ),
    );
  return SETTINGS_TOPICS.map((t) => ({
    ...t,
    enabled: wantsEmail(choices, t.topic),
  }));
}

/** Saves a person's choice for every topic the settings page offers. */
export async function saveEmailSettings(
  db: Db,
  userId: UserId,
  enabledTopics: ReadonlySet<string>,
): Promise<void> {
  for (const { topic } of SETTINGS_TOPICS) {
    const enabled = enabledTopics.has(topic);
    await db
      .insert(notificationPreference)
      .values({ userId, topic, channel: "email", enabled })
      .onConflictDoUpdate({
        target: [
          notificationPreference.userId,
          notificationPreference.topic,
          notificationPreference.channel,
        ],
        set: { enabled },
      });
  }
}

/** A person's alert limits for the settings page: theirs, or the defaults. */
export async function alertLimitsFor(
  db: Db,
  userId: UserId,
): Promise<AlertLimits> {
  const limits = await alertLimitsOf(db, [userId]);
  return required(limits.get(userId), "alert limits");
}

/**
 * Saves a person's alert limits. Messages already held for a digest move
 * to the next digest under the new choice, so switching to a daily digest
 * brings them sooner.
 */
export async function saveAlertLimits(
  db: Db,
  userId: UserId,
  limits: AlertLimits,
  { now, timeZone }: { now: Date; timeZone: string },
): Promise<void> {
  const values = {
    dailyCap: limits.dailyCap,
    digest: limits.digest,
    quietStartHour: limits.quietHours?.startHour ?? null,
    quietEndHour: limits.quietHours?.endHour ?? null,
  };
  await db
    .insert(alertSetting)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: alertSetting.userId, set: values });
  await db
    .update(message)
    .set({ sendAfter: nextDigestAt(now, timeZone, limits.digest) })
    .where(and(eq(message.userId, userId), eq(message.status, "held")));
}
