import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { MessageId, UserId } from "@/domain/ids";
import {
  type Choice,
  isPushTopic,
  type Topic,
  wantsEmail,
  wantsPush,
} from "@/domain/notifications/topics";
import { afterFailure, CLAIM_MS } from "@/domain/outbox/retry";
import type { Result } from "@/domain/result";
import type { EmailSender } from "@/services/email";
import type { PushSender } from "@/services/push";
import { user } from "../schema/auth";
import {
  message,
  type NewMessage,
  notificationPreference,
  pushSubscription,
} from "../schema/message";
import type { Db } from "./schedule";

/**
 * The outbox: how every league notice is written and delivered. See
 * docs/architecture.md, section 5 ("The outbox").
 *
 * Writing: call enqueueMessages inside the same transaction as the change
 * that caused the notice, so the two commit or roll back together.
 *
 * Delivering: drainOutbox claims due rows with one atomic update (skip
 * locked, so two workers never claim the same row), sends each with the
 * message id as the provider's idempotency key, and records the outcome
 * only while it still holds the claim.
 */

export type OutboxMessage = Pick<
  NewMessage,
  | "userId"
  | "topic"
  | "template"
  | "payload"
  | "dedupeKey"
  | "sendAfter"
  | "announcementId"
>;

/**
 * Queues messages. A message whose dedupe key is already in the outbox is
 * skipped, so writing the same notice twice is harmless. Returns how many
 * emails were new.
 *
 * A message about a push topic also gets a push copy for each person who
 * has a device subscribed and push turned on for that topic. The copy is
 * its own row (channel push, dedupe key `push:<key>`), so email and push
 * retry and settle independently.
 */
export async function enqueueMessages(
  db: Db,
  messages: readonly OutboxMessage[],
): Promise<number> {
  if (messages.length === 0) return 0;
  const created = await db
    .insert(message)
    .values([...messages])
    .onConflictDoNothing({ target: message.dedupeKey })
    .returning({ id: message.id });
  const pushable = messages.filter((m) => isPushTopic(m.topic));
  if (pushable.length > 0) {
    const wanted = await pushWanted(db, pushable);
    const copies = pushable
      .filter((m) => wanted.has(`${m.userId}/${m.topic}`))
      .map((m) => ({
        ...m,
        channel: "push" as const,
        dedupeKey: pushKey(m.dedupeKey),
      }));
    if (copies.length > 0)
      await db
        .insert(message)
        .values(copies)
        .onConflictDoNothing({ target: message.dedupeKey });
  }
  return created.length;
}

/** The dedupe key of a notice's push copy. */
export const pushKey = (dedupeKey: string) => `push:${dedupeKey}`;

/**
 * Which of these people want a push about which topic: those with at
 * least one subscribed device and push on for the topic, as
 * `<userId>/<topic>`. One query for the whole batch.
 */
async function pushWanted(
  db: Db,
  messages: readonly OutboxMessage[],
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({
      userId: notificationPreference.userId,
      topic: notificationPreference.topic,
    })
    .from(notificationPreference)
    .innerJoin(
      pushSubscription,
      eq(pushSubscription.userId, notificationPreference.userId),
    )
    .where(
      and(
        inArray(notificationPreference.userId, [
          ...new Set(messages.map((m) => m.userId)),
        ]),
        inArray(notificationPreference.topic, [
          ...new Set(messages.map((m) => m.topic)),
        ]),
        eq(notificationPreference.channel, "push"),
        eq(notificationPreference.enabled, true),
      ),
    );
  return new Set(rows.map((r) => `${r.userId}/${r.topic}`));
}

/** A message as a phone notification. */
export type PushContent = {
  title: string;
  body: string;
  /** The page a tap opens, on this site. */
  path: string;
};

export type Rendered = {
  subject: string;
  html: string;
  text: string;
  /** Without it, a push copy shows the subject and opens the home screen. */
  push?: PushContent;
};

/** Turns a stored template name and payload into an email, or says why it cannot. */
export type Renderer = (
  template: string,
  payload: Record<string, unknown>,
) => Result<Rendered, string>;

export type Channel = "email" | "push";

export type ClaimedMessage = {
  id: MessageId;
  userId: UserId;
  topic: Topic;
  channel: Channel | "sms";
  template: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * Claims up to `limit` messages that are due: queued and past send_after,
 * or held by a worker whose claim has lapsed. One statement, so a row is
 * claimed by exactly one caller.
 */
export async function claimDueMessages(
  db: Db,
  now: Date,
  limit: number,
  channels: readonly Channel[] = ["email", "push"],
): Promise<ClaimedMessage[]> {
  const due = db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        inArray(message.channel, [...channels]),
        or(
          and(eq(message.status, "queued"), lte(message.sendAfter, now)),
          and(eq(message.status, "sending"), lte(message.lockedUntil, now)),
        ),
      ),
    )
    .orderBy(message.sendAfter)
    .limit(limit)
    .for("update", { skipLocked: true });
  return db
    .update(message)
    .set({
      status: "sending",
      lockedUntil: new Date(now.getTime() + CLAIM_MS),
      attempts: sql`${message.attempts} + 1`,
    })
    .where(inArray(message.id, due))
    .returning({
      id: message.id,
      userId: message.userId,
      topic: message.topic,
      channel: message.channel,
      template: message.template,
      payload: message.payload,
      attempts: message.attempts,
    });
}

/** Only the worker still holding this claim may record an outcome. */
const stillClaimed = (m: ClaimedMessage) =>
  and(
    eq(message.id, m.id),
    eq(message.status, "sending"),
    eq(message.attempts, m.attempts),
  );

async function settle(
  db: Db,
  m: ClaimedMessage,
  set: Partial<typeof message.$inferInsert>,
): Promise<void> {
  await db
    .update(message)
    .set({ lockedUntil: null, ...set })
    .where(stillClaimed(m));
}

export type DrainResult = {
  sent: number;
  retrying: number;
  failed: number;
  /** Not sent on purpose: the person turned it off, or has no device left. */
  suppressed: number;
};

export const emptyDrain = (): DrainResult => ({
  sent: 0,
  retrying: 0,
  failed: 0,
  suppressed: 0,
});

/** Records a failed attempt: a retry after backoff, or failed for good. */
async function retryOrFail(
  db: Db,
  m: ClaimedMessage,
  error: string,
  now: Date,
  result: DrainResult,
): Promise<void> {
  const next = afterFailure(m.attempts, now);
  await settle(db, m, { ...next, lastError: error.slice(0, 500) });
  if (next.status === "failed") result.failed++;
  else result.retrying++;
}

/**
 * Sends every due message, up to `limit`. Safe to run twice or at the same
 * time as another drain: each row is claimed once, and a resend after a
 * lapsed claim reuses the idempotency key (email) or push topic (push).
 * Preferences are read at send time, so turning a topic off also stops
 * messages already queued.
 *
 * Without an email sender only push rows are claimed, and email waits.
 * Without a push sender, push rows are suppressed (`push_off`).
 */
export async function drainOutbox(
  db: Db,
  {
    send,
    push = null,
    render,
    now,
    limit = 50,
  }: {
    send: EmailSender | null;
    push?: PushSender | null;
    render: Renderer;
    now: Date;
    limit?: number;
  },
): Promise<DrainResult> {
  const result = emptyDrain();
  const claimed = await claimDueMessages(
    db,
    now,
    limit,
    send ? ["email", "push"] : ["push"],
  );
  if (claimed.length === 0) return result;
  const userIds = [...new Set(claimed.map((m) => m.userId))];
  const recipients = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.id, userIds));
  const emailOf = new Map(recipients.map((r) => [r.id, r.email]));
  const choices = await db
    .select({
      userId: notificationPreference.userId,
      topic: notificationPreference.topic,
      channel: notificationPreference.channel,
      enabled: notificationPreference.enabled,
    })
    .from(notificationPreference)
    .where(
      and(
        inArray(notificationPreference.userId, userIds),
        inArray(notificationPreference.channel, ["email", "push"]),
      ),
    );
  const choicesOf = (userId: UserId, channel: Channel): Choice[] =>
    choices.filter((c) => c.userId === userId && c.channel === channel);
  const pushUsers = [
    ...new Set(
      claimed.filter((m) => m.channel === "push").map((m) => m.userId),
    ),
  ];
  const devices =
    push && pushUsers.length > 0
      ? await db
          .select({
            id: pushSubscription.id,
            userId: pushSubscription.userId,
            endpoint: pushSubscription.endpoint,
            p256dh: pushSubscription.p256dh,
            auth: pushSubscription.auth,
          })
          .from(pushSubscription)
          .where(inArray(pushSubscription.userId, pushUsers))
      : [];

  for (const m of claimed) {
    if (m.channel === "push") {
      await deliverPush(db, m, {
        wanted: wantsPush(choicesOf(m.userId, "push"), m.topic),
        push,
        render,
        devices: devices.filter((d) => d.userId === m.userId),
        now,
        result,
      });
      continue;
    }
    if (m.channel !== "email" || !send) {
      // Nothing sends this channel yet; it is not claimed in practice.
      await settle(db, m, {
        status: "suppressed",
        suppressReason: "channel_off",
      });
      result.suppressed++;
      continue;
    }
    if (!wantsEmail(choicesOf(m.userId, "email"), m.topic)) {
      await settle(db, m, {
        status: "suppressed",
        suppressReason: "opted_out",
      });
      result.suppressed++;
      continue;
    }
    const rendered = render(m.template, m.payload);
    const to = emailOf.get(m.userId);
    if (!rendered.ok || !to) {
      // Retrying cannot fix a message that cannot be built.
      await settle(db, m, {
        status: "failed",
        lastError: rendered.ok ? "No email address" : rendered.error,
      });
      result.failed++;
      continue;
    }
    const { subject, html, text } = rendered.value;
    const sent = await send({
      to,
      subject,
      html,
      text,
      idempotencyKey: `message/${m.id}`,
    });
    if (sent.ok) {
      await settle(db, m, {
        status: "sent",
        providerMessageId: sent.value.id,
        sentAt: now,
        lastError: null,
      });
      result.sent++;
      continue;
    }
    await retryOrFail(db, m, sent.error, now, result);
  }
  return result;
}

/** How long a push service keeps trying an offline phone. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

/**
 * Sends one push message to each of the person's devices. Sent when any
 * device accepted it; a device whose push service says it is gone (404 or
 * 410) is deleted; suppressed when no device is left; retried when every
 * device failed for another reason. A retry goes to every device again, so
 * the push topic (the message id) and the notification tag make a repeat
 * replace the first copy instead of showing twice.
 */
async function deliverPush(
  db: Db,
  m: ClaimedMessage,
  {
    wanted,
    push,
    render,
    devices,
    now,
    result,
  }: {
    wanted: boolean;
    push: PushSender | null;
    render: Renderer;
    devices: {
      id: typeof pushSubscription.$inferSelect.id;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    now: Date;
    result: DrainResult;
  },
): Promise<void> {
  const suppress = async (reason: string) => {
    await settle(db, m, { status: "suppressed", suppressReason: reason });
    result.suppressed++;
  };
  if (!wanted) return suppress("opted_out");
  if (!push) return suppress("push_off");
  if (devices.length === 0) return suppress("no_device");
  const rendered = render(m.template, m.payload);
  if (!rendered.ok) {
    await settle(db, m, { status: "failed", lastError: rendered.error });
    result.failed++;
    return;
  }
  const content = rendered.value.push ?? {
    title: rendered.value.subject,
    body: "",
    path: "/app",
  };
  const tag = m.id.replaceAll("-", "");
  const notification = { ...content, tag };
  const errors: string[] = [];
  const gone: (typeof devices)[number]["id"][] = [];
  const delivered: (typeof devices)[number]["id"][] = [];
  let providerId: string | null = null;
  for (const device of devices) {
    const outcome = await push(device, notification, {
      topic: tag,
      ttl: PUSH_TTL_SECONDS,
      urgency: m.topic === "rainout" ? "high" : "normal",
    });
    if (outcome.ok) {
      delivered.push(device.id);
      providerId ??= outcome.id;
    } else if (outcome.gone) gone.push(device.id);
    else errors.push(outcome.error);
  }
  if (gone.length > 0)
    await db.delete(pushSubscription).where(inArray(pushSubscription.id, gone));
  if (delivered.length > 0) {
    await db
      .update(pushSubscription)
      .set({ lastSuccessAt: now })
      .where(inArray(pushSubscription.id, delivered));
    await settle(db, m, {
      status: "sent",
      providerMessageId: providerId ?? `push/${delivered.length}`,
      sentAt: now,
      lastError: null,
    });
    result.sent++;
    return;
  }
  if (errors.length === 0) return suppress("no_device");
  await retryOrFail(db, m, errors.join("; "), now, result);
}
