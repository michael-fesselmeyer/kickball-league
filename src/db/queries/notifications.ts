import { and, eq, sql } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import { type AlertLimits, nextDigestAt } from "@/domain/notifications/limits";
import {
  type Choice,
  SETTINGS_TOPICS,
  type Topic,
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

/**
 * Where a choice saved from the settings page was changed: the settings,
 * when the save changed it; otherwise where it was changed before, so an
 * unsubscribe is still counted as one after the page is saved again.
 */
export const changedViaSettings = sql`case when excluded.enabled is distinct from ${notificationPreference.enabled} then 'settings'::preference_source else ${notificationPreference.changedVia} end`;

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
      .values({ userId, topic, channel: "email", enabled, changedVia: "settings" })
      .onConflictDoUpdate({
        target: [
          notificationPreference.userId,
          notificationPreference.topic,
          notificationPreference.channel,
        ],
        set: { enabled, changedVia: changedViaSettings },
      });
  }
}

/**
 * Turns one topic's email off for a person, from an email's one-click
 * unsubscribe (src/lib/unsubscribe.ts). Doing it again changes nothing.
 */
export async function turnOffEmailTopic(
  db: Db,
  userId: UserId,
  topic: Topic,
): Promise<void> {
  await db
    .insert(notificationPreference)
    .values({
      userId,
      topic,
      channel: "email",
      enabled: false,
      changedVia: "email_link",
    })
    .onConflictDoUpdate({
      target: [
        notificationPreference.userId,
        notificationPreference.topic,
        notificationPreference.channel,
      ],
      set: { enabled: false, changedVia: "email_link" },
    });
}

/**
 * League news is opt-in (#331): a new account starts with announcement
 * email switched off, and the person turns it on in their email settings.
 * It writes an explicit choice rather than changing the default, so
 * everyone who already has an account keeps what they have. Urgent game
 * messages are other topics and are untouched; a choice already saved is
 * never overwritten.
 */
export async function startWithNewsOff(db: Db, userId: UserId): Promise<void> {
  await db
    .insert(notificationPreference)
    .values({
      userId,
      topic: "announcement",
      channel: "email",
      enabled: false,
    })
    .onConflictDoNothing();
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
