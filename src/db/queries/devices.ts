import { and, desc, eq, gt, ne } from "drizzle-orm";
import { deviceName } from "@/domain/auth/device-name";
import type { UserId } from "@/domain/ids";
import { session } from "../schema/auth";
import type { Db } from "./schedule";

/**
 * The devices signed in to an account: one Better Auth session each
 * (docs/architecture.md, section 4). Rows never carry the session token, so
 * the page can show and act on them by id without handling a secret.
 */
export type SignedInDevice = {
  id: string;
  name: string;
  signedInAt: Date;
  lastUsedAt: Date;
  current: boolean;
};

/** Live sessions, most recently used first, with the current one marked. */
export async function signedInDevices(
  db: Db,
  userId: UserId,
  currentSessionId: string,
  now: Date,
): Promise<SignedInDevice[]> {
  const rows = await db
    .select({
      id: session.id,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
    .orderBy(desc(session.updatedAt), desc(session.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: deviceName(row.userAgent),
    signedInAt: row.createdAt,
    lastUsedAt: row.updatedAt,
    current: row.id === currentSessionId,
  }));
}

/**
 * Signs one of the person's other devices out. The person's own id is part
 * of the match, so an id from someone else's account deletes nothing, and
 * the current session is kept (signing out here is the sign-out button).
 */
export async function signOutDevice(
  db: Db,
  userId: UserId,
  sessionId: string,
  currentSessionId: string,
): Promise<boolean> {
  if (sessionId === currentSessionId) return false;
  const deleted = await db
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id });
  return deleted.length > 0;
}

/** Signs out every device but this one; returns how many were signed out. */
export async function signOutOtherDevices(
  db: Db,
  userId: UserId,
  currentSessionId: string,
): Promise<number> {
  const deleted = await db
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, currentSessionId)))
    .returning({ id: session.id });
  return deleted.length;
}
