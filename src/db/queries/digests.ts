import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { MessageId, UserId } from "@/domain/ids";
import { DIGEST_KIND } from "@/domain/notifications/kinds";
import { DEFAULT_LIMITS } from "@/domain/notifications/limits";
import { wantsEmail, wantsPush } from "@/domain/notifications/topics";
import { message, notificationPreference } from "../schema/message";
import { alertLimitsOf, type Renderer } from "./outbox";
import type { Db } from "./schedule";

export type DigestResult = {
  /** Digest emails queued, one per person. */
  digests: number;
  /** Held messages that went into them. */
  messages: number;
  /** Held messages the person turned off since, or already got by email. */
  suppressed: number;
  /** Held messages that could not be built. */
  failed: number;
};

const PUSH_PREFIX = "push:";

/** The notice a row is a copy of: its email and push copies share it. */
const noticeKey = (dedupeKey: string) =>
  dedupeKey.startsWith(PUSH_PREFIX)
    ? dedupeKey.slice(PUSH_PREFIX.length)
    : dedupeKey;

type HeldRow = {
  id: MessageId;
  userId: UserId;
  topic: (typeof message.$inferSelect)["topic"];
  channel: (typeof message.$inferSelect)["channel"];
  template: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

/**
 * The digest job (docs/architecture.md, section 5): takes every held
 * message whose digest is due, and queues one digest email per person
 * listing them. Run it inside a transaction: the held rows are locked
 * (skip locked, so two runs never take the same row) until they are marked
 * digested, so running it twice never sends a message twice.
 *
 * A notice held on both channels is listed once. A held push whose email
 * copy already went out on its own is not listed again, and a message the
 * person turned off since it was held is suppressed, as the outbox would.
 * Each item is the message's own push text: its heading, first paragraph
 * and page.
 */
export async function buildDigests(
  db: Db,
  { render, now, limit = 500 }: { render: Renderer; now: Date; limit?: number },
): Promise<DigestResult> {
  const result: DigestResult = {
    digests: 0,
    messages: 0,
    suppressed: 0,
    failed: 0,
  };
  const held: HeldRow[] = await db
    .select({
      id: message.id,
      userId: message.userId,
      topic: message.topic,
      channel: message.channel,
      template: message.template,
      payload: message.payload,
      dedupeKey: message.dedupeKey,
    })
    .from(message)
    .where(and(eq(message.status, "held"), lte(message.sendAfter, now)))
    .orderBy(asc(message.userId), asc(message.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  if (held.length === 0) return result;

  const userIds = [...new Set(held.map((m) => m.userId))];
  const [choices, limits, sentByEmail] = await Promise.all([
    db
      .select({
        userId: notificationPreference.userId,
        topic: notificationPreference.topic,
        channel: notificationPreference.channel,
        enabled: notificationPreference.enabled,
      })
      .from(notificationPreference)
      .where(inArray(notificationPreference.userId, userIds)),
    alertLimitsOf(db, userIds),
    emailCopiesSent(db, held),
  ]);
  const wanted = (m: HeldRow) => {
    const mine = choices.filter(
      (c) => c.userId === m.userId && c.channel === m.channel,
    );
    return m.channel === "push"
      ? wantsPush(mine, m.topic)
      : wantsEmail(mine, m.topic);
  };

  const suppressed: { id: MessageId; reason: string }[] = [];
  const failed: { id: MessageId; error: string }[] = [];
  for (const userId of userIds) {
    const notices = new Map<string, HeldRow[]>();
    for (const m of held.filter((h) => h.userId === userId)) {
      if (!wanted(m)) {
        suppressed.push({ id: m.id, reason: "opted_out" });
        continue;
      }
      const key = noticeKey(m.dedupeKey);
      notices.set(key, [...(notices.get(key) ?? []), m]);
    }
    const items: { title: string; text: string; path: string }[] = [];
    const digested: MessageId[] = [];
    for (const [key, copies] of notices) {
      const first = copies.find((c) => c.channel === "email") ?? copies[0];
      if (!first) continue;
      if (first.channel === "push" && sentByEmail.has(key)) {
        for (const c of copies)
          suppressed.push({ id: c.id, reason: "sent_by_email" });
        continue;
      }
      const rendered = render(first.template, first.payload);
      if (!rendered.ok) {
        for (const c of copies)
          failed.push({ id: c.id, error: rendered.error });
        continue;
      }
      const push = rendered.value.push;
      items.push({
        title: push?.title ?? rendered.value.subject,
        text: push?.body ?? "",
        path: push?.path ?? "/app",
      });
      digested.push(...copies.map((c) => c.id));
    }
    if (items.length === 0) continue;
    const mine = limits.get(userId) ?? DEFAULT_LIMITS;
    const [digest] = await db
      .insert(message)
      .values({
        userId,
        topic: "digest",
        channel: "email",
        template: DIGEST_KIND,
        payload: {
          frequency: mine.digest,
          dailyCap: mine.dailyCap,
          items,
        },
        dedupeKey: `digest/${userId}/${now.toISOString()}`,
        sendAfter: now,
      })
      .returning({ id: message.id });
    if (!digest) continue;
    await db
      .update(message)
      .set({ status: "digested", digestId: digest.id })
      .where(inArray(message.id, digested));
    result.digests++;
    result.messages += digested.length;
  }
  for (const reason of new Set(suppressed.map((s) => s.reason)))
    await db
      .update(message)
      .set({ status: "suppressed", suppressReason: reason })
      .where(
        inArray(
          message.id,
          suppressed.filter((s) => s.reason === reason).map((s) => s.id),
        ),
      );
  for (const f of failed)
    await db
      .update(message)
      .set({ status: "failed", lastError: f.error.slice(0, 500) })
      .where(eq(message.id, f.id));
  result.suppressed = suppressed.length;
  result.failed = failed.length;
  return result;
}

/** The notices among these whose email copy was already sent on its own. */
async function emailCopiesSent(
  db: Db,
  held: readonly HeldRow[],
): Promise<Set<string>> {
  const keys = held
    .filter((m) => m.channel === "push")
    .map((m) => noticeKey(m.dedupeKey));
  if (keys.length === 0) return new Set();
  const rows = await db
    .select({ dedupeKey: message.dedupeKey })
    .from(message)
    .where(
      and(
        inArray(message.dedupeKey, keys),
        eq(message.channel, "email"),
        eq(message.status, "sent"),
      ),
    );
  return new Set(rows.map((r) => r.dedupeKey));
}
