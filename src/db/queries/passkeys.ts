import { and, asc, count, eq } from "drizzle-orm";
import type { UserId } from "@/domain/ids";
import { passkey } from "../schema/auth";
import type { Db } from "./schedule";

/**
 * A person's passkeys for the account page. Better Auth's passkey plugin
 * creates them and checks them at sign-in; listing, renaming and removing
 * happen here, behind the page's Server Actions (docs/architecture.md,
 * section 4). The public key and credential id are never sent to the page.
 */
export type SavedPasskey = {
  id: string;
  name: string | null;
  /** "multiDevice" passkeys sync, through iCloud Keychain or a password manager. */
  synced: boolean;
  createdAt: Date | null;
};

export const PASSKEY_NAME_MAX = 60;

export async function passkeysOf(
  db: Db,
  userId: UserId,
): Promise<SavedPasskey[]> {
  const rows = await db
    .select({
      id: passkey.id,
      name: passkey.name,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
    })
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(asc(passkey.createdAt), asc(passkey.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    synced: row.deviceType === "multiDevice" || row.backedUp,
    createdAt: row.createdAt,
  }));
}

export async function hasPasskey(db: Db, userId: UserId): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(passkey)
    .where(eq(passkey.userId, userId));
  return (row?.n ?? 0) > 0;
}

/** Renames one of the person's own passkeys; false if it isn't theirs. */
export async function renamePasskey(
  db: Db,
  userId: UserId,
  id: string,
  name: string,
): Promise<boolean> {
  const updated = await db
    .update(passkey)
    .set({ name: name.trim().slice(0, PASSKEY_NAME_MAX) || null })
    .where(and(eq(passkey.id, id), eq(passkey.userId, userId)))
    .returning({ id: passkey.id });
  return updated.length > 0;
}

/** Removes one of the person's own passkeys; false if it isn't theirs. */
export async function removePasskey(
  db: Db,
  userId: UserId,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(passkey)
    .where(and(eq(passkey.id, id), eq(passkey.userId, userId)))
    .returning({ id: passkey.id });
  return deleted.length > 0;
}
