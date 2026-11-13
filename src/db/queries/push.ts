import { and, count, eq } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import {
  type Choice,
  PUSH_TOPICS,
  wantsPush,
} from "@/domain/notifications/topics";
import type { DeviceSubscription } from "@/domain/notifications/push";
import { notificationPreference, pushSubscription } from "../schema/message";
import type { Db } from "./schedule";

/**
 * Web push subscriptions and push choices (docs/architecture.md, section
 * 14, "Push notifications"). A device is subscribed from the profile page;
 * the outbox reads these when it sends, and deletes a device whose push
 * service says it is gone.
 */

/** How many devices get this person's pushes. */
export async function countPushDevices(db: Db, userId: UserId) {
  const [row] = await db
    .select({ n: count() })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, userId));
  return row?.n ?? 0;
}

/** The push section of the profile page: each push topic, and how many devices. */
export async function pushSettingsOf(db: Db, userId: UserId) {
  const [choices, devices] = await Promise.all([
    db
      .select({
        topic: notificationPreference.topic,
        enabled: notificationPreference.enabled,
      })
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.userId, userId),
          eq(notificationPreference.channel, "push"),
        ),
      ) as Promise<Choice[]>,
    countPushDevices(db, userId),
  ]);
  return {
    devices,
    topics: PUSH_TOPICS.map((t) => ({
      ...t,
      enabled: wantsPush(choices, t.topic),
    })),
  };
}

/** Saves a person's push choice for every push topic. */
export async function savePushSettings(
  db: Db,
  userId: UserId,
  enabledTopics: ReadonlySet<string>,
): Promise<void> {
  for (const { topic } of PUSH_TOPICS) {
    const enabled = enabledTopics.has(topic);
    await db
      .insert(notificationPreference)
      .values({ userId, topic, channel: "push", enabled })
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

/**
 * Remembers a device for this person. A browser has one endpoint, so an
 * endpoint seen before moves to whoever subscribed it last (a shared
 * phone that someone else signed in on), with its current keys.
 */
export async function savePushSubscription(
  db: Db,
  userId: UserId,
  device: DeviceSubscription,
): Promise<void> {
  const values = {
    userId,
    endpoint: device.endpoint,
    p256dh: device.keys.p256dh,
    auth: device.keys.auth,
    userAgent: device.userAgent,
  };
  await db
    .insert(pushSubscription)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: { ...values, createdAt: new Date(), lastSuccessAt: null },
    });
}

/** Forgets one of this person's devices. Someone else's is left alone. */
export async function removePushSubscription(
  db: Db,
  userId: UserId,
  endpoint: string,
): Promise<boolean> {
  const removed = await db
    .delete(pushSubscription)
    .where(
      and(
        eq(pushSubscription.userId, userId),
        eq(pushSubscription.endpoint, endpoint),
      ),
    )
    .returning({ id: pushSubscription.id });
  return removed.length > 0;
}
