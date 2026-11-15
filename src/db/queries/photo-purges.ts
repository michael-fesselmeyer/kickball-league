import { and, eq, gt, gte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { LeagueId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import type { Db } from "./schedule";

/**
 * Failed purges of a taken-down photo's cached copies (ADR 0069), kept in
 * the league's audit log so admins see them and the daily job can retry
 * them. A failure stays due until a later `photo_cache.purged` row for the
 * same photo, or until the optimizer's copies have expired on their own.
 */
export const PURGE_FAILED = "photo_cache.purge_failed";
export const PURGED = "photo_cache.purged";
const ENTITY = "photo_cache";

export type PhotoPurge = { src: string; leagueId: LeagueId };

/** The photo's id: the last part of its address, `/media/<kind>/<id>`. */
const photoId = (src: string) => src.slice(src.lastIndexOf("/") + 1);

async function record(db: Db, action: string, purges: PhotoPurge[]) {
  if (purges.length === 0) return;
  await db.insert(auditLog).values(
    purges.map(({ src, leagueId }) => ({
      leagueId,
      actorId: null,
      action,
      entityType: ENTITY,
      entityId: photoId(src),
      after: { src },
    })),
  );
}

/** Records purges that failed even after their retry. */
export const recordFailedPurges = (db: Db, purges: PhotoPurge[]) =>
  record(db, PURGE_FAILED, purges);

/** Records failed purges that a later retry got through. */
export const recordRetriedPurges = (db: Db, purges: PhotoPurge[]) =>
  record(db, PURGED, purges);

/**
 * Every failed purge still due: newer than `maxAgeSeconds` (older copies
 * have expired anyway) and not cleared by a later retry. One per address.
 */
export async function duePurges(
  db: Db,
  now: Date,
  maxAgeSeconds: number,
): Promise<PhotoPurge[]> {
  const done = alias(auditLog, "done");
  const rows = await db
    .select({
      src: sql<string>`${auditLog.after}->>'src'`,
      leagueId: auditLog.leagueId,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, ENTITY),
        eq(auditLog.action, PURGE_FAILED),
        gt(auditLog.occurredAt, new Date(now.getTime() - maxAgeSeconds * 1000)),
        notExists(
          db
            .select({ one: sql`1` })
            .from(done)
            .where(
              and(
                eq(done.entityType, ENTITY),
                eq(done.entityId, auditLog.entityId),
                eq(done.action, PURGED),
                gte(done.occurredAt, auditLog.occurredAt),
              ),
            ),
        ),
      ),
    );
  const bySrc = new Map(rows.map((r) => [r.src, r]));
  return [...bySrc.values()].sort((a, b) => a.src.localeCompare(b.src));
}
