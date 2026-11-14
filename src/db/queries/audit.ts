import { and, desc, eq, like, lt, notLike, or } from "drizzle-orm";
import type { AuditLogId, UserId } from "@/domain/ids";
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
  id: AuditLogId;
  action: string;
  entityType: string;
  actorEmail: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  occurredAt: Date;
};

/**
 * The audit log, newest first, `limit` at a time. Pass the last row shown
 * (its time and id) as `before` for the next page: rows written in one
 * transaction share a time, so the id breaks the tie and none is skipped. With
 * `operatorOnly`, just the platform operator's actions (ADR 0009). The
 * owners' books (`books.*`, ADR 0034) are left out unless `withBooks`, so
 * admins who read the log never see them.
 */
export async function auditLogPage(
  db: Db,
  options: {
    before?: { occurredAt: Date; id?: AuditLogId | undefined } | undefined;
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
        afterRow(options.before),
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

/** Rows that sort after `row` in the log's order: older, or as old with a lower id. */
function afterRow(
  row: { occurredAt: Date; id?: AuditLogId | undefined } | undefined,
) {
  if (!row) return undefined;
  if (!row.id) return lt(auditLog.occurredAt, row.occurredAt);
  return or(
    lt(auditLog.occurredAt, row.occurredAt),
    and(eq(auditLog.occurredAt, row.occurredAt), lt(auditLog.id, row.id)),
  );
}
