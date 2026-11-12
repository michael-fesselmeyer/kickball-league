import type { UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
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
