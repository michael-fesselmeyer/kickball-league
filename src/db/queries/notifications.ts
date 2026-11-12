import { and, eq } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import {
  type Choice,
  SETTINGS_TOPICS,
  wantsEmail,
} from "@/domain/notifications/topics";
import { notificationPreference } from "../schema/message";
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
