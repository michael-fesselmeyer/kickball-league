import { and, count, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { MessageId, UserId } from "@/domain/ids";
import {
  type EmailBudget,
  emailsLeft,
  FREE_EMAIL_BUDGET,
  isQuotaRefusal,
  nextUtcDay,
  startOfUtcDay,
  startOfUtcMonth,
  whenOutOfEmail,
} from "@/domain/notifications/email-budget";
import {
  DIGEST_KIND,
  type DeliveryClass,
  deliveryClassOf,
  EMAIL_BUDGET_KIND,
  type MessageKind,
  NON_URGENT_KINDS,
} from "@/domain/notifications/kinds";
import {
  type AlertLimits,
  DEFAULT_LIMITS,
  decide,
  nextDigestAt,
  startOfLocalDay,
} from "@/domain/notifications/limits";
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
import { profile } from "../schema/profile";
import {
  alertSetting,
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
  "userId" | "topic" | "payload" | "dedupeKey" | "sendAfter" | "announcementId"
> & {
  /** Its kind says whether it is urgent (src/domain/notifications/kinds.ts). */
  template: MessageKind;
};

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
  /** "Because you play in this game.": why the person got it. */
  reason?: string;
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
  dedupeKey: string;
  sendAfter: Date;
};

/** Urgent first, then news that can wait and the digest. */
const urgencyRank = sql<number>`case when ${inArray(message.template, [
  ...NON_URGENT_KINDS,
  DIGEST_KIND,
])} then 1 else 0 end`;

/** People with a push copy last: their phone already has the news. */
const pushCopyRank = sql<number>`case when exists (select 1 from ${message} as push_copy where push_copy.dedupe_key = 'push:' || ${message.dedupeKey}) then 1 else 0 end`;

/**
 * Claims up to `limit` messages that are due: queued and past send_after,
 * or held by a worker whose claim has lapsed. One statement, so a row is
 * claimed by exactly one caller. With `byPriority` (email, while the
 * day's quota is limited) urgent messages come first, and among them the
 * people without a push copy, so the quota goes where it is needed.
 */
export async function claimDueMessages(
  db: Db,
  now: Date,
  limit: number,
  channels: readonly Channel[] = ["email", "push"],
  { byPriority = false }: { byPriority?: boolean } = {},
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
    .orderBy(
      ...(byPriority ? [urgencyRank, pushCopyRank] : []),
      message.sendAfter,
    )
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
      dedupeKey: message.dedupeKey,
      sendAfter: message.sendAfter,
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
  /** Non-urgent, queued again for when the person's quiet hours end. */
  waiting: number;
  /** Non-urgent and over the person's daily cap: held for their digest. */
  held: number;
  /** Email the day's quota could not cover: queued again for tomorrow. */
  nextDay: number;
};

export const emptyDrain = (): DrainResult => ({
  sent: 0,
  retrying: 0,
  failed: 0,
  suppressed: 0,
  waiting: 0,
  held: 0,
  nextDay: 0,
});

/** The league's time zone when the caller does not name one. */
export const DEFAULT_TIME_ZONE = "America/New_York";

/** Each person's alert limits; people without a saved row get the defaults. */
export async function alertLimitsOf(
  db: Db,
  userIds: readonly UserId[],
): Promise<Map<UserId, AlertLimits>> {
  const limits = new Map<UserId, AlertLimits>(
    userIds.map((id) => [id, DEFAULT_LIMITS]),
  );
  if (userIds.length === 0) return limits;
  const rows = await db
    .select()
    .from(alertSetting)
    .where(inArray(alertSetting.userId, [...userIds]));
  for (const row of rows)
    limits.set(row.userId, {
      dailyCap: row.dailyCap,
      digest: row.digest,
      quietHours:
        row.quietStartHour === null || row.quietEndHour === null
          ? null
          : { startHour: row.quietStartHour, endHour: row.quietEndHour },
    });
  return limits;
}

/**
 * How many non-urgent messages each person has been sent since local
 * midnight, per channel, as `<userId>/<channel>`. One query for the batch.
 */
async function sentTodayOf(
  db: Db,
  userIds: readonly UserId[],
  now: Date,
  timeZone: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: message.userId,
      channel: message.channel,
      sent: count(),
    })
    .from(message)
    .where(
      and(
        inArray(message.userId, [...userIds]),
        eq(message.status, "sent"),
        gte(message.sentAt, startOfLocalDay(now, timeZone)),
        inArray(message.template, [...NON_URGENT_KINDS]),
      ),
    )
    .groupBy(message.userId, message.channel);
  return new Map(rows.map((r) => [`${r.userId}/${r.channel}`, r.sent]));
}

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
 *
 * Each wanted message then goes through the person's alert limits
 * (src/domain/notifications/limits.ts) in the league's time zone: urgent
 * ones are sent (a push silently in quiet hours), and non-urgent ones are
 * sent, queued again for the end of quiet hours, or held for the digest
 * once the day's cap is reached. Waiting and holding give the claim's
 * attempt back, since nothing was tried.
 */
export async function drainOutbox(
  db: Db,
  {
    send,
    push = null,
    render,
    now,
    timeZone = DEFAULT_TIME_ZONE,
    emailBudget = FREE_EMAIL_BUDGET,
    limit = 50,
  }: {
    send: EmailSender | null;
    push?: PushSender | null;
    render: Renderer;
    now: Date;
    timeZone?: string;
    /** The email provider's free quota, which the drain never goes past. */
    emailBudget?: EmailBudget;
    limit?: number;
  },
): Promise<DrainResult> {
  const result = emptyDrain();
  // Push first: it is free, and an urgent email whose push copy went out
  // can give its place in the email quota to someone without push.
  const pushClaimed = await claimDueMessages(db, now, limit, ["push"]);
  const emailClaimed = send
    ? await claimDueMessages(db, now, limit, ["email"], { byPriority: true })
    : [];
  const claimed = [...pushClaimed, ...emailClaimed];
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

  const limits = await alertLimitsOf(db, userIds);
  const sentToday = claimed.some(
    (m) => deliveryClassOf(m.template) === "non_urgent",
  )
    ? await sentTodayOf(db, userIds, now, timeZone)
    : new Map<string, number>();

  let emailUse = { today: 0, month: 0 };
  let pushSent = new Set<string>();
  let quotaRefused = false;
  let urgentForTomorrow = 0;

  /** An email the quota cannot cover now: delivered by push, tomorrow, or in the digest. */
  const outOfEmail = async (m: ClaimedMessage, kind: DeliveryClass) => {
    const next = whenOutOfEmail(kind, { pushSent: pushSent.has(m.dedupeKey) });
    if (next === "pushed") {
      await settle(db, m, {
        status: "suppressed",
        suppressReason: "sent_by_push",
      });
      result.suppressed++;
      return;
    }
    const digest = next === "digest";
    await settle(db, m, {
      status: digest ? "held" : "queued",
      sendAfter: digest
        ? nextDigestAt(
            now,
            timeZone,
            (limits.get(m.userId) ?? DEFAULT_LIMITS).digest,
          )
        : nextUtcDay(now),
      attempts: m.attempts - 1,
    });
    if (digest) result.held++;
    else result.nextDay++;
    if (kind === "urgent" && m.template !== EMAIL_BUDGET_KIND)
      urgentForTomorrow++;
  };

  const handle = async (m: ClaimedMessage): Promise<void> => {
    const channel = m.channel;
    if (channel === "sms" || (channel === "email" && !send)) {
      // Nothing sends this channel yet; it is not claimed in practice.
      await settle(db, m, {
        status: "suppressed",
        suppressReason: "channel_off",
      });
      result.suppressed++;
      return;
    }
    const wanted =
      channel === "push"
        ? wantsPush(choicesOf(m.userId, "push"), m.topic)
        : wantsEmail(choicesOf(m.userId, "email"), m.topic);
    if (!wanted) {
      await settle(db, m, {
        status: "suppressed",
        suppressReason: "opted_out",
      });
      result.suppressed++;
      return;
    }
    const kind = deliveryClassOf(m.template);
    const counted = `${m.userId}/${channel}`;
    const decision = decide({
      class: kind,
      channel,
      now,
      timeZone,
      limits: limits.get(m.userId) ?? DEFAULT_LIMITS,
      sentToday: sentToday.get(counted) ?? 0,
    });
    if (decision.action !== "send") {
      await settle(db, m, {
        status: decision.action === "wait" ? "queued" : "held",
        sendAfter: decision.until,
        attempts: m.attempts - 1,
      });
      if (decision.action === "wait") result.waiting++;
      else result.held++;
      return;
    }
    if (channel === "email") {
      const left = quotaRefused
        ? 0
        : emailsLeft(emailBudget, emailUse, {
            reserve: m.template === EMAIL_BUDGET_KIND,
          });
      if (left <= 0) {
        await outOfEmail(m, kind);
        return;
      }
    }
    const delivered =
      channel === "push"
        ? (await deliverPush(db, m, {
            push,
            render,
            devices: devices.filter((d) => d.userId === m.userId),
            silent: decision.silent,
            urgent: kind === "urgent",
            now,
            result,
          }))
          ? "sent"
          : "failed"
        : send
          ? await deliverEmail(db, m, {
              send,
              render,
              to: emailOf.get(m.userId),
              now,
              result,
            })
          : "failed";
    if (delivered === "quota") {
      // The provider's own count says the quota is gone, whatever ours says.
      quotaRefused = true;
      await outOfEmail(m, kind);
      return;
    }
    if (delivered === "sent" && channel === "email")
      emailUse = { today: emailUse.today + 1, month: emailUse.month + 1 };
    if (delivered === "sent" && kind === "non_urgent")
      sentToday.set(counted, (sentToday.get(counted) ?? 0) + 1);
  };

  for (const m of pushClaimed) await handle(m);
  // The pushes have settled: count today's email and see whose phone
  // already has the news, then send email in priority order.
  [emailUse, pushSent] = await Promise.all([
    emailsSent(db, now),
    pushCopiesSent(db, emailClaimed),
  ]);
  const rank = (m: ClaimedMessage) =>
    (deliveryClassOf(m.template) === "urgent" ? 0 : 2) +
    (pushSent.has(m.dedupeKey) ? 1 : 0);
  const emails = [...emailClaimed].sort(
    (a, b) =>
      rank(a) - rank(b) || a.sendAfter.getTime() - b.sendAfter.getTime(),
  );
  for (const m of emails) await handle(m);
  if (urgentForTomorrow > 0)
    await tellAdminsEmailRanOut(db, {
      now,
      timeZone,
      waiting: urgentForTomorrow,
      budget: emailBudget,
    });
  return result;
}

/** Emails the outbox sent today and this month, as the provider counts days. */
async function emailsSent(
  db: Db,
  now: Date,
): Promise<{ today: number; month: number }> {
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${message.sentAt} >= ${startOfUtcDay(now)})::int`,
      month: count(),
    })
    .from(message)
    .where(
      and(
        eq(message.channel, "email"),
        eq(message.status, "sent"),
        gte(message.sentAt, startOfUtcMonth(now)),
      ),
    );
  return { today: row?.today ?? 0, month: row?.month ?? 0 };
}

/** The dedupe keys, among these emails, whose push copy has been sent. */
async function pushCopiesSent(
  db: Db,
  emails: readonly ClaimedMessage[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .select({ dedupeKey: message.dedupeKey })
    .from(message)
    .where(
      and(
        inArray(
          message.dedupeKey,
          emails.map((m) => pushKey(m.dedupeKey)),
        ),
        eq(message.status, "sent"),
      ),
    );
  return new Set(rows.map((r) => r.dedupeKey.slice("push:".length)));
}

/**
 * Tells every admin, once a UTC day, that urgent email is waiting for
 * tomorrow's quota. The notice is urgent and may use the reserve, so it
 * goes even when ordinary email has stopped.
 */
async function tellAdminsEmailRanOut(
  db: Db,
  {
    now,
    timeZone,
    waiting,
    budget,
  }: { now: Date; timeZone: string; waiting: number; budget: EmailBudget },
): Promise<void> {
  const admins = await db
    .select({ id: profile.userId })
    .from(profile)
    .where(inArray(profile.globalRole, ["admin", "owner"]));
  if (admins.length === 0) return;
  const day = startOfUtcDay(now).toISOString().slice(0, 10);
  const resumes = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(nextUtcDay(now));
  await enqueueMessages(
    db,
    admins.map((a) => ({
      userId: a.id,
      topic: "operations" as const,
      template: EMAIL_BUDGET_KIND,
      payload: {
        waiting,
        resumes,
        daily: budget.daily,
        monthly: budget.monthly,
      },
      dedupeKey: `email-budget/${day}/${a.id}`,
      sendAfter: now,
    })),
  );
}

/**
 * Sends one email: "sent" when the provider accepted it, "quota" when it
 * refused because the account's quota is used up (nothing is recorded; the
 * caller decides), "failed" otherwise (failed or retrying).
 */
async function deliverEmail(
  db: Db,
  m: ClaimedMessage,
  {
    send,
    render,
    to,
    now,
    result,
  }: {
    send: EmailSender;
    render: Renderer;
    to: string | undefined;
    now: Date;
    result: DrainResult;
  },
): Promise<"sent" | "quota" | "failed"> {
  const rendered = render(m.template, m.payload);
  if (!rendered.ok || !to) {
    // Retrying cannot fix a message that cannot be built.
    await settle(db, m, {
      status: "failed",
      lastError: rendered.ok ? "No email address" : rendered.error,
    });
    result.failed++;
    return "failed";
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
    return "sent";
  }
  if (isQuotaRefusal(sent.error)) return "quota";
  await retryOrFail(db, m, sent.error, now, result);
  return "failed";
}

/** Where a push's "Change alerts" button goes: the push settings. */
export const PUSH_SETTINGS_PATH = "/app/profile#push";

/** How long a push service keeps trying an offline phone. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

/**
 * Sends one push message to each of the person's devices. Sent when any
 * device accepted it; a device whose push service says it is gone (404 or
 * 410) is deleted; suppressed when no device is left; retried when every
 * device failed for another reason. A retry goes to every device again, so
 * the push topic (the message id) and the notification tag make a repeat
 * replace the first copy instead of showing twice. True when sent.
 */
async function deliverPush(
  db: Db,
  m: ClaimedMessage,
  {
    push,
    render,
    devices,
    silent,
    urgent,
    now,
    result,
  }: {
    push: PushSender | null;
    render: Renderer;
    devices: {
      id: typeof pushSubscription.$inferSelect.id;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    /** Quiet hours: show it without sound or vibration. */
    silent: boolean;
    urgent: boolean;
    now: Date;
    result: DrainResult;
  },
): Promise<boolean> {
  const suppress = async (reason: string) => {
    await settle(db, m, { status: "suppressed", suppressReason: reason });
    result.suppressed++;
    return false;
  };
  if (!push) return suppress("push_off");
  if (devices.length === 0) return suppress("no_device");
  const rendered = render(m.template, m.payload);
  if (!rendered.ok) {
    await settle(db, m, { status: "failed", lastError: rendered.error });
    result.failed++;
    return false;
  }
  const content = rendered.value.push ?? {
    title: rendered.value.subject,
    body: "",
    path: "/app",
  };
  const tag = m.id.replaceAll("-", "");
  const notification = {
    ...content,
    tag,
    silent,
    settingsPath: PUSH_SETTINGS_PATH,
  };
  const errors: string[] = [];
  const gone: (typeof devices)[number]["id"][] = [];
  const delivered: (typeof devices)[number]["id"][] = [];
  let providerId: string | null = null;
  for (const device of devices) {
    const outcome = await push(device, notification, {
      topic: tag,
      ttl: PUSH_TTL_SECONDS,
      urgency: urgent ? "high" : "normal",
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
    return true;
  }
  if (errors.length === 0) return suppress("no_device");
  await retryOrFail(db, m, errors.join("; "), now, result);
  return false;
}
