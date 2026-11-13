import { and, asc, eq, ne, sql, sum } from "drizzle-orm";
import type { FriendFields } from "@/domain/friends/friend-form";
import { logoFits } from "@/domain/friends/logo";
import type {
  FriendLeagueId,
  FriendLogoId,
  LeagueId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { friendLeague, friendLogo } from "../schema/friends";
import { recordAudit } from "./audit";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * The "friends of the league" directory: other local leagues, managed by
 * admins and listed on the public /friends page (docs/data-model.md,
 * section 2.5). The writes record their audit row in the same transaction;
 * callers run them inside one.
 */

export type FriendLeague = FriendFields & {
  id: FriendLeagueId;
  logo: { id: FriendLogoId; width: number; height: number } | null;
  updatedAt: Date;
};

const COLUMNS = {
  id: friendLeague.id,
  name: friendLeague.name,
  activity: friendLeague.activity,
  area: friendLeague.area,
  description: friendLeague.description,
  url: friendLeague.url,
  linksBack: friendLeague.linksBack,
  updatedAt: friendLeague.updatedAt,
  logoId: friendLogo.id,
  logoWidth: friendLogo.width,
  logoHeight: friendLogo.height,
};

function toFriend(row: {
  id: FriendLeagueId;
  name: string;
  activity: FriendFields["activity"];
  area: string | null;
  description: string | null;
  url: string;
  linksBack: boolean;
  updatedAt: Date;
  logoId: FriendLogoId | null;
  logoWidth: number | null;
  logoHeight: number | null;
}): FriendLeague {
  const { logoId, logoWidth, logoHeight, ...rest } = row;
  return {
    ...rest,
    logo:
      logoId !== null && logoWidth !== null && logoHeight !== null
        ? { id: logoId, width: logoWidth, height: logoHeight }
        : null,
  };
}

/** Every entry in the league's directory, by name, in one query. */
export async function friendDirectory(
  db: Db,
  leagueId: LeagueId,
): Promise<FriendLeague[]> {
  const rows = await db
    .select(COLUMNS)
    .from(friendLeague)
    .leftJoin(friendLogo, eq(friendLogo.friendLeagueId, friendLeague.id))
    .where(eq(friendLeague.leagueId, leagueId))
    .orderBy(asc(friendLeague.name));
  return rows.map(toFriend);
}

/** One entry of the league's directory, or null. */
export async function friendLeagueById(
  db: Db,
  leagueId: LeagueId,
  id: FriendLeagueId,
): Promise<FriendLeague | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(friendLeague)
    .leftJoin(friendLogo, eq(friendLogo.friendLeagueId, friendLeague.id))
    .where(and(eq(friendLeague.id, id), eq(friendLeague.leagueId, leagueId)));
  return row ? toFriend(row) : null;
}

export type FriendSaveError = "name_taken" | "not_found";

async function nameTaken(
  db: Db,
  leagueId: LeagueId,
  name: string,
  except: FriendLeagueId | null,
): Promise<boolean> {
  const found = await db
    .select({ id: friendLeague.id })
    .from(friendLeague)
    .where(
      and(
        eq(friendLeague.leagueId, leagueId),
        sql`lower(${friendLeague.name}) = lower(${name})`,
        except ? ne(friendLeague.id, except) : undefined,
      ),
    );
  return found.length > 0;
}

/** Adds a league to the directory. */
export async function createFriendLeague(
  db: Db,
  input: { leagueId: LeagueId; fields: FriendFields; actorId: UserId },
): Promise<Result<FriendLeagueId, FriendSaveError>> {
  if (await nameTaken(db, input.leagueId, input.fields.name, null))
    return err("name_taken");
  const created = required(
    (
      await db
        .insert(friendLeague)
        .values({
          leagueId: input.leagueId,
          ...input.fields,
          createdBy: input.actorId,
        })
        .returning({ id: friendLeague.id })
    )[0],
    "friend_league insert",
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "friend_league.create",
    entityType: "friend_league",
    entityId: created.id,
    after: input.fields,
  });
  return ok(created.id);
}

const fieldsOf = (f: FriendLeague): FriendFields => ({
  name: f.name,
  activity: f.activity,
  area: f.area,
  description: f.description,
  url: f.url,
  linksBack: f.linksBack,
});

/** Changes an entry's details. */
export async function updateFriendLeague(
  db: Db,
  input: {
    leagueId: LeagueId;
    id: FriendLeagueId;
    fields: FriendFields;
    actorId: UserId;
  },
): Promise<Result<null, FriendSaveError>> {
  const before = await friendLeagueById(db, input.leagueId, input.id);
  if (!before) return err("not_found");
  if (await nameTaken(db, input.leagueId, input.fields.name, input.id))
    return err("name_taken");
  await db
    .update(friendLeague)
    .set(input.fields)
    .where(eq(friendLeague.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "friend_league.update",
    entityType: "friend_league",
    entityId: input.id,
    before: fieldsOf(before),
    after: input.fields,
  });
  return ok(null);
}

/** Takes a league out of the directory, with its logo. */
export async function removeFriendLeague(
  db: Db,
  input: { leagueId: LeagueId; id: FriendLeagueId; actorId: UserId },
): Promise<Result<null, "not_found">> {
  const before = await friendLeagueById(db, input.leagueId, input.id);
  if (!before) return err("not_found");
  // The logo goes with it (on delete cascade).
  await db.delete(friendLeague).where(eq(friendLeague.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "friend_league.remove",
    entityType: "friend_league",
    entityId: input.id,
    before: { ...fieldsOf(before), hadLogo: before.logo !== null },
  });
  return ok(null);
}

/** Bytes of every stored logo together. */
export async function storedLogoBytes(db: Db): Promise<number> {
  const [row] = await db
    .select({ total: sum(friendLogo.byteSize).mapWith(Number) })
    .from(friendLogo);
  return row?.total ?? 0;
}

export type StoredLogo = {
  contentType: "image/webp" | "image/png";
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
};

/**
 * Saves an entry's logo, replacing the one it had, unless the new copy
 * would take the stored logos past their cap. Concurrent saves wait for
 * each other, so two at once can't both squeeze in under the cap.
 */
export async function setFriendLogo(
  db: Db,
  input: {
    leagueId: LeagueId;
    id: FriendLeagueId;
    logo: StoredLogo;
    actorId: UserId;
  },
): Promise<Result<FriendLogoId, "not_found" | "logo_store_full">> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('friend_logo'))`);
  const entry = await friendLeagueById(db, input.leagueId, input.id);
  if (!entry) return err("not_found");
  const [replaced] = await db
    .select({ byteSize: friendLogo.byteSize })
    .from(friendLogo)
    .where(eq(friendLogo.friendLeagueId, input.id));
  const fits = logoFits({
    storedBytes: await storedLogoBytes(db),
    replacedBytes: replaced?.byteSize ?? 0,
    newBytes: input.logo.bytes.length,
  });
  if (!fits) return err("logo_store_full");
  await db.delete(friendLogo).where(eq(friendLogo.friendLeagueId, input.id));
  const saved = required(
    (
      await db
        .insert(friendLogo)
        .values({
          friendLeagueId: input.id,
          ...input.logo,
          byteSize: input.logo.bytes.length,
        })
        .returning({ id: friendLogo.id })
    )[0],
    "friend_logo insert",
  );
  // Marks the entry changed, so the sitemap and caches see a new date.
  await db
    .update(friendLeague)
    .set({ updatedAt: new Date() })
    .where(eq(friendLeague.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "friend_league.logo_set",
    entityType: "friend_league",
    entityId: input.id,
    before: replaced ? { logoBytes: replaced.byteSize } : null,
    after: {
      logoBytes: input.logo.bytes.length,
      width: input.logo.width,
      height: input.logo.height,
    },
  });
  return ok(saved.id);
}

/** Removes an entry's logo, if it has one. */
export async function removeFriendLogo(
  db: Db,
  input: { leagueId: LeagueId; id: FriendLeagueId; actorId: UserId },
): Promise<Result<null, "not_found">> {
  const entry = await friendLeagueById(db, input.leagueId, input.id);
  if (!entry?.logo) return err("not_found");
  await db.delete(friendLogo).where(eq(friendLogo.friendLeagueId, input.id));
  await db
    .update(friendLeague)
    .set({ updatedAt: new Date() })
    .where(eq(friendLeague.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "friend_league.logo_remove",
    entityType: "friend_league",
    entityId: input.id,
  });
  return ok(null);
}

/** A logo for its public address, or null. */
export async function storedFriendLogo(
  db: Db,
  id: FriendLogoId,
): Promise<{ contentType: string; bytes: Buffer; sha256: string } | null> {
  const [row] = await db
    .select({
      contentType: friendLogo.contentType,
      bytes: friendLogo.bytes,
      sha256: friendLogo.sha256,
    })
    .from(friendLogo)
    .where(eq(friendLogo.id, id));
  return row ?? null;
}
