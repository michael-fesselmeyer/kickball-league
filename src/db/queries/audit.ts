import { and, desc, eq, like, lt, notLike } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import type { Db } from "./schedule";

export type AuditEntry = {
  actorId: UserId | null;
  /** `area.verb`, for example schedule.publish. */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
};

/**
 * Records an admin or captain change. Call it inside the same transaction
 * as the change, so the change and its record commit together or not at all.
 */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
  });
}

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  actorEmail: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  occurredAt: Date;
};

/**
 * The audit log, newest first, `limit` at a time. Pass the oldest
 * `occurredAt` already shown as `before` for the next page. With
 * `operatorOnly`, just the platform operator's actions (ADR 0009). The
 * owners' books (`books.*`, ADR 0034) are left out unless `withBooks`, so
 * admins who read the log never see them.
 */
export async function auditLogPage(
  db: Db,
  options: {
    before?: Date | undefined;
    limit?: number;
    operatorOnly?: boolean;
    withBooks?: boolean;
  } = {},
): Promise<{ rows: AuditRow[]; more: boolean }> {
  const limit = options.limit ?? 50;
  const found = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      actorEmail: user.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      before: auditLog.before,
      after: auditLog.after,
      occurredAt: auditLog.occurredAt,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .leftJoin(profile, eq(profile.userId, auditLog.actorId))
    .where(
      and(
        options.before ? lt(auditLog.occurredAt, options.before) : undefined,
        options.operatorOnly ? like(auditLog.action, "operator.%") : undefined,
        options.withBooks ? undefined : notLike(auditLog.action, "books.%"),
      ),
    )
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(limit + 1);
  return {
    rows: found.slice(0, limit).map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      actorEmail: r.actorEmail,
      actorName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
      before: r.before,
      after: r.after,
      occurredAt: r.occurredAt,
    })),
    more: found.length > limit,
  };
}
