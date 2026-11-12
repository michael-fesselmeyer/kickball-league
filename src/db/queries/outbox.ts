import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { MessageId, UserId } from "@/domain/ids";
import { afterFailure, CLAIM_MS } from "@/domain/outbox/retry";
import type { Result } from "@/domain/result";
import type { EmailSender } from "@/services/email";
import { user } from "../schema/auth";
import { message, type NewMessage } from "../schema/message";
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
  "userId" | "topic" | "template" | "payload" | "dedupeKey" | "sendAfter"
>;

/**
 * Queues messages. A message whose dedupe key is already in the outbox is
 * skipped, so writing the same notice twice is harmless. Returns how many
 * were new.
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
  return created.length;
}

export type Rendered = { subject: string; html: string; text: string };

/** Turns a stored template name and payload into an email, or says why it cannot. */
export type Renderer = (
  template: string,
  payload: Record<string, unknown>,
) => Result<Rendered, string>;

export type ClaimedMessage = {
  id: MessageId;
  userId: UserId;
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
): Promise<ClaimedMessage[]> {
  const due = db
    .select({ id: message.id })
    .from(message)
    .where(
      or(
        and(eq(message.status, "queued"), lte(message.sendAfter, now)),
        and(eq(message.status, "sending"), lte(message.lockedUntil, now)),
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
};

/**
 * Sends every due message, up to `limit`. Safe to run twice or at the same
 * time as another drain: each row is claimed once, and a resend after a
 * lapsed claim reuses the idempotency key.
 */
export async function drainOutbox(
  db: Db,
  {
    send,
    render,
    now,
    limit = 50,
  }: { send: EmailSender; render: Renderer; now: Date; limit?: number },
): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, retrying: 0, failed: 0 };
  const claimed = await claimDueMessages(db, now, limit);
  if (claimed.length === 0) return result;
  const recipients = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(
      inArray(
        user.id,
        claimed.map((m) => m.userId),
      ),
    );
  const emailOf = new Map(recipients.map((r) => [r.id, r.email]));

  for (const m of claimed) {
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
    const sent = await send({
      to,
      ...rendered.value,
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
    const next = afterFailure(m.attempts, now);
    await settle(db, m, {
      ...next,
      lastError: sent.error.slice(0, 500),
    });
    if (next.status === "failed") result.failed++;
    else result.retrying++;
  }
  return result;
}
