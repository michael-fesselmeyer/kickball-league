import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type {
  EventId,
  LeagueId,
  SocialAccountId,
  SocialImageId,
  SocialPostId,
  TeamId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  fitUnderCap,
  postsToKeep,
  STORAGE_CAP_BYTES,
} from "@/domain/social/storage";
import { planSync, type SyncPlan } from "@/domain/social/sync-plan";
import type { InstagramStorageFullPayload } from "@/emails/instagram-storage-full";
import type { InstagramReconnectPayload } from "@/emails/instagram-reconnect";
import { decryptToken, encryptToken } from "@/lib/social/token-crypto";
import type {
  DownloadedImage,
  InstagramError,
  Profile,
  RecentPost,
  Token,
} from "@/services/instagram";
import { user } from "../schema/auth";
import { event } from "../schema/event";
import { profile } from "../schema/profile";
import { socialAccount, socialImage, socialPost } from "../schema/social";
import { team } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * The league's Instagram connection (docs/architecture.md, section 17):
 * connecting, syncing, refreshing the token, curating posts and reading
 * what public pages show. Network calls happen outside these functions;
 * they take what was fetched and write it in the caller's transaction.
 */

/** Binds a stored token to its row (src/lib/social/token-crypto.ts). */
const tokenBinding = (id: SocialAccountId) => `social_account:${id}`;

export type AccountSummary = {
  id: SocialAccountId;
  username: string;
  status: "active" | "needs_reconnect" | "disconnected";
  showNewest: boolean;
  lastSyncedAt: Date | null;
  lastError: string | null;
  tokenExpiresAt: Date | null;
};

/** The admin screen's view of the connection; never the token. */
export async function instagramAccount(
  db: Db,
  leagueId: LeagueId,
): Promise<AccountSummary | null> {
  const [row] = await db
    .select({
      id: socialAccount.id,
      username: socialAccount.username,
      status: socialAccount.status,
      showNewest: socialAccount.showNewest,
      lastSyncedAt: socialAccount.lastSyncedAt,
      lastError: socialAccount.lastError,
      tokenExpiresAt: socialAccount.tokenExpiresAt,
    })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.leagueId, leagueId),
        eq(socialAccount.provider, "instagram"),
      ),
    );
  return row ?? null;
}

/**
 * Saves a new connection, or a reconnection of the same account. Connecting
 * a different account removes the previous account's posts, since they are
 * not this account's to show.
 */
export async function saveConnection(
  db: Db,
  input: {
    leagueId: LeagueId;
    profile: Profile;
    token: Token;
    secret: string;
    actorId: UserId;
    now: Date;
  },
): Promise<SocialAccountId> {
  const [existing] = await db
    .select({ id: socialAccount.id, externalId: socialAccount.externalId })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.leagueId, input.leagueId),
        eq(socialAccount.provider, "instagram"),
      ),
    )
    .for("update");
  const id = existing?.id ?? (randomUUID() as SocialAccountId);
  const values = {
    externalId: input.profile.externalId,
    username: input.profile.username,
    status: "active" as const,
    tokenCiphertext: encryptToken(
      input.token.accessToken,
      input.secret,
      tokenBinding(id),
    ),
    tokenExpiresAt: input.token.expiresAt,
    tokenRefreshedAt: input.now,
    lastError: null,
    connectedBy: input.actorId,
  };
  if (existing) {
    if (existing.externalId !== input.profile.externalId)
      await db.delete(socialPost).where(eq(socialPost.accountId, id));
    await db.update(socialAccount).set(values).where(eq(socialAccount.id, id));
  } else {
    await db.insert(socialAccount).values({
      id,
      leagueId: input.leagueId,
      provider: "instagram",
      ...values,
    });
  }
  await recordAudit(db, {
    actorId: input.actorId,
    action: "instagram.connect",
    entityType: "social_account",
    entityId: id,
    after: { username: input.profile.username },
  });
  return id;
}

/**
 * Stops the sync and deletes the token. With keepPhotos false, every synced
 * post and photo goes too.
 */
export async function disconnect(
  db: Db,
  input: { leagueId: LeagueId; keepPhotos: boolean; actorId: UserId },
): Promise<boolean> {
  const account = await instagramAccount(db, input.leagueId);
  if (!account) return false;
  await db
    .update(socialAccount)
    .set({
      status: "disconnected",
      tokenCiphertext: null,
      tokenExpiresAt: null,
      lastError: null,
    })
    .where(eq(socialAccount.id, account.id));
  if (!input.keepPhotos)
    await db.delete(socialPost).where(eq(socialPost.accountId, account.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "instagram.disconnect",
    entityType: "social_account",
    entityId: account.id,
    after: { keepPhotos: input.keepPhotos },
  });
  return true;
}

export async function setShowNewest(
  db: Db,
  input: { leagueId: LeagueId; on: boolean; actorId: UserId },
): Promise<boolean> {
  const updated = await db
    .update(socialAccount)
    .set({ showNewest: input.on })
    .where(
      and(
        eq(socialAccount.leagueId, input.leagueId),
        eq(socialAccount.provider, "instagram"),
      ),
    )
    .returning({ id: socialAccount.id });
  const id = updated[0]?.id;
  if (!id) return false;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "instagram.show_newest",
    entityType: "social_account",
    entityId: id,
    after: { showNewest: input.on },
  });
  return true;
}

export type ConnectedAccount = {
  id: SocialAccountId;
  leagueId: LeagueId;
  token: string;
  tokenRefreshedAt: Date | null;
};

/**
 * Accounts the jobs work on: connected, with a token that still decrypts.
 * One that no longer decrypts (the auth secret changed) is set to need
 * reconnecting.
 */
export async function connectedAccounts(
  db: Db,
  secret: string,
  now: Date,
): Promise<ConnectedAccount[]> {
  const rows = await db
    .select({
      id: socialAccount.id,
      leagueId: socialAccount.leagueId,
      ciphertext: socialAccount.tokenCiphertext,
      tokenRefreshedAt: socialAccount.tokenRefreshedAt,
    })
    .from(socialAccount)
    .where(eq(socialAccount.status, "active"));
  const accounts: ConnectedAccount[] = [];
  for (const row of rows) {
    const token = row.ciphertext
      ? decryptToken(row.ciphertext, secret, tokenBinding(row.id))
      : null;
    if (token) accounts.push({ ...row, token });
    else
      await recordProblem(
        db,
        row.id,
        { kind: "auth", message: "The saved connection could not be read" },
        now,
      );
  }
  return accounts;
}

export type StoredPost = {
  externalId: string;
  takenAt: Date;
  featured: boolean;
  cover: "home" | "team" | null;
};

/** What the sync already has for an account, to plan against. */
export async function storedPosts(
  db: Db,
  accountId: SocialAccountId,
): Promise<StoredPost[]> {
  return db
    .select({
      externalId: socialPost.externalId,
      takenAt: socialPost.takenAt,
      featured: socialPost.featured,
      cover: socialPost.cover,
    })
    .from(socialPost)
    .where(eq(socialPost.accountId, accountId));
}

/**
 * The posts the site keeps after this sync (src/domain/social/storage.ts):
 * the newest of what stays plus what arrives, and every curated one.
 */
function keptAfter(
  stored: readonly StoredPost[],
  plan: SyncPlan<RecentPost>,
): Set<string> {
  const removed = new Set(plan.remove);
  return postsToKeep([
    ...stored.filter((p) => !removed.has(p.externalId)),
    ...plan.add.map((p) => ({ ...p, featured: false, cover: null })),
  ]);
}

/**
 * Which fetched posts need their photo copied: new ones the site will
 * keep. A new post too old to keep is never downloaded.
 */
export function postsToCopy(
  stored: readonly StoredPost[],
  fetched: { posts: RecentPost[]; complete: boolean },
): RecentPost[] {
  const plan = planSync(stored, fetched.posts, fetched.complete);
  const keep = keptAfter(stored, plan);
  return plan.add.filter((p) => keep.has(p.externalId));
}

/** Bytes of every stored photo, the figure the storage cap limits. */
export async function storedImageBytes(db: Db): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${socialImage.byteSize}), 0)`,
    })
    .from(socialImage);
  return Number(row?.total ?? 0);
}

export type SyncResult = {
  added: number;
  updated: number;
  /** Deleted on Instagram, or too old to keep. */
  removed: number;
  /** New posts left for the next sync because their photo could not be copied. */
  skipped: number;
  /** New posts left out because the photo storage cap was reached. */
  full: boolean;
};

export const STORAGE_FULL_MESSAGE =
  "Photo storage is full, so the newest posts weren't copied. Unfeature or hide older photos to make room";

/**
 * Writes one sync, in this order: deletes posts removed on Instagram and
 * posts too old to keep (src/domain/social/storage.ts), refreshes caption,
 * link and type of the rest without touching curation, then inserts new
 * posts with their copied photos, newest first, while the photos stay
 * under the storage cap. When the cap stops it, the account notes why and
 * admins are told once a month. Run it in one transaction.
 */
export async function applySync(
  db: Db,
  input: {
    accountId: SocialAccountId;
    fetched: { posts: RecentPost[]; complete: boolean };
    images: ReadonlyMap<string, DownloadedImage>;
    now: Date;
    /** Tests pass a smaller cap. */
    capBytes?: number;
  },
): Promise<SyncResult> {
  const stored = await storedPosts(db, input.accountId);
  const plan = planSync(stored, input.fetched.posts, input.fetched.complete);
  const keep = keptAfter(stored, plan);
  const gone = [
    ...plan.remove,
    ...stored
      .filter((p) => !keep.has(p.externalId))
      .map((p) => p.externalId)
      .filter((id) => !plan.remove.includes(id)),
  ];
  if (gone.length > 0)
    await db
      .delete(socialPost)
      .where(
        and(
          eq(socialPost.accountId, input.accountId),
          inArray(socialPost.externalId, gone),
        ),
      );

  const kept = plan.update.filter((p) => keep.has(p.externalId));
  for (const post of kept) {
    await db
      .update(socialPost)
      .set({
        permalink: post.permalink,
        caption: post.caption,
        mediaType: post.mediaType,
      })
      .where(
        and(
          eq(socialPost.accountId, input.accountId),
          eq(socialPost.externalId, post.externalId),
        ),
      );
  }

  const arriving = plan.add.filter((p) => keep.has(p.externalId));
  const copied = arriving.flatMap((post) => {
    const image = input.images.get(post.externalId);
    return image
      ? [{ post, image, takenAt: post.takenAt, size: image.bytes.length }]
      : [];
  });
  const { accepted, full } = fitUnderCap(
    await storedImageBytes(db),
    copied,
    input.capBytes,
  );
  let added = 0;
  for (const { post, image } of accepted) {
    const [row] = await db
      .insert(socialPost)
      .values({
        accountId: input.accountId,
        externalId: post.externalId,
        permalink: post.permalink,
        caption: post.caption,
        mediaType: post.mediaType,
        takenAt: post.takenAt,
      })
      .onConflictDoNothing()
      .returning({ id: socialPost.id });
    if (!row) continue;
    await db.insert(socialImage).values({
      postId: row.id,
      contentType: image.contentType,
      bytes: image.bytes,
      byteSize: image.bytes.length,
      sha256: createHash("sha256").update(image.bytes).digest("hex"),
    });
    added++;
  }

  await db
    .update(socialAccount)
    .set({
      lastSyncedAt: input.now,
      lastError: full ? STORAGE_FULL_MESSAGE : null,
    })
    .where(eq(socialAccount.id, input.accountId));
  if (full) await tellAdminsStorageIsFull(db, input.accountId, input.now);
  return {
    added,
    updated: kept.length,
    removed: gone.length,
    skipped: arriving.length - copied.length,
    full,
  };
}

/** Everyone who can manage the league's photos. */
async function adminIds(db: Db): Promise<UserId[]> {
  const rows = await db
    .select({ id: user.id })
    .from(profile)
    .innerJoin(user, eq(profile.userId, user.id))
    .where(inArray(profile.globalRole, ["admin", "owner"]));
  return rows.map((r) => r.id);
}

/** One email per admin per month while the photo storage stays full. */
async function tellAdminsStorageIsFull(
  db: Db,
  accountId: SocialAccountId,
  now: Date,
): Promise<void> {
  const month = now.toISOString().slice(0, 7);
  const payload = {
    capMegabytes: Math.round(STORAGE_CAP_BYTES / (1024 * 1024)),
  } satisfies InstagramStorageFullPayload;
  await enqueueMessages(
    db,
    (await adminIds(db)).map((id) => ({
      userId: id,
      topic: "announcement" as const,
      template: "instagram_storage_full",
      payload,
      dedupeKey: `instagram-storage-full/${accountId}/${month}/${id}`,
      sendAfter: now,
    })),
  );
}

/** Stores a refreshed token. */
export async function saveRefreshedToken(
  db: Db,
  input: {
    accountId: SocialAccountId;
    token: Token;
    secret: string;
    now: Date;
  },
): Promise<void> {
  await db
    .update(socialAccount)
    .set({
      tokenCiphertext: encryptToken(
        input.token.accessToken,
        input.secret,
        tokenBinding(input.accountId),
      ),
      tokenExpiresAt: input.token.expiresAt,
      tokenRefreshedAt: input.now,
      lastError: null,
    })
    .where(
      and(
        eq(socialAccount.id, input.accountId),
        eq(socialAccount.status, "active"),
      ),
    );
}

/**
 * Records a failed sync or refresh. A refused token sets the account to
 * need reconnecting and emails every admin once; anything else is noted
 * for the admin screen and retried by the next run. Photos stay up either
 * way.
 */
export async function recordProblem(
  db: Db,
  accountId: SocialAccountId,
  problem: InstagramError,
  now: Date,
): Promise<void> {
  if (problem.kind === "other") {
    await db
      .update(socialAccount)
      .set({ lastError: problem.message })
      .where(eq(socialAccount.id, accountId));
    return;
  }
  const [account] = await db
    .update(socialAccount)
    .set({ status: "needs_reconnect", lastError: problem.message })
    .where(
      and(eq(socialAccount.id, accountId), eq(socialAccount.status, "active")),
    )
    .returning({
      username: socialAccount.username,
      refreshedAt: socialAccount.tokenRefreshedAt,
    });
  if (!account) return;
  const admins = await adminIds(db);
  const payload = {
    username: account.username,
    reason: problem.message,
  } satisfies InstagramReconnectPayload;
  // One notice per connection: reconnecting starts a new one.
  const connection = (account.refreshedAt ?? now).toISOString();
  await enqueueMessages(
    db,
    admins.map((id) => ({
      userId: id,
      topic: "announcement" as const,
      template: "instagram_reconnect",
      payload,
      dedupeKey: `instagram-reconnect/${accountId}/${connection}/${id}`,
      sendAfter: now,
    })),
  );
}

export type AdminPost = {
  id: SocialPostId;
  imageId: SocialImageId | null;
  permalink: string;
  caption: string | null;
  altText: string | null;
  mediaType: "image" | "video" | "carousel";
  takenAt: Date;
  featured: boolean;
  hidden: boolean;
  teamId: TeamId | null;
  eventId: EventId | null;
  cover: "home" | "team" | null;
};

/** Every synced post, newest first, for the admin screen. */
export async function adminPosts(
  db: Db,
  leagueId: LeagueId,
): Promise<AdminPost[]> {
  return db
    .select({
      id: socialPost.id,
      imageId: socialImage.id,
      permalink: socialPost.permalink,
      caption: socialPost.caption,
      altText: socialPost.altText,
      mediaType: socialPost.mediaType,
      takenAt: socialPost.takenAt,
      featured: socialPost.featured,
      hidden: socialPost.hidden,
      teamId: socialPost.teamId,
      eventId: socialPost.eventId,
      cover: socialPost.cover,
    })
    .from(socialPost)
    .innerJoin(socialAccount, eq(socialPost.accountId, socialAccount.id))
    .leftJoin(socialImage, eq(socialImage.postId, socialPost.id))
    .where(eq(socialAccount.leagueId, leagueId))
    .orderBy(desc(socialPost.takenAt));
}

/** The league's teams, to tag posts with. */
export async function taggableTeams(db: Db, leagueId: LeagueId) {
  return db
    .select({ id: team.id, name: team.name, slug: team.slug })
    .from(team)
    .where(and(eq(team.leagueId, leagueId), sql`${team.deletedAt} is null`))
    .orderBy(asc(team.name));
}

/** The league's events, newest first, to tag posts with. */
export async function taggableEvents(db: Db, leagueId: LeagueId) {
  return db
    .select({ id: event.id, title: event.title, startsAt: event.startsAt })
    .from(event)
    .where(and(eq(event.leagueId, leagueId), sql`${event.deletedAt} is null`))
    .orderBy(desc(event.startsAt));
}

export type Curation =
  | { kind: "feature"; on: boolean }
  | { kind: "hide"; on: boolean }
  | { kind: "team"; teamId: TeamId | null }
  | { kind: "event"; eventId: EventId | null }
  | { kind: "cover"; cover: "home" | "team" | null }
  | { kind: "alt"; text: string };

export type CurationError =
  | "not_found"
  | "unknown_team"
  | "unknown_event"
  | "cover_needs_team"
  | "alt_too_long";

/**
 * One admin change to a post. Hiding also unfeatures it and drops its
 * cover; featuring or making it a cover shows it again. A page has one
 * cover: setting one replaces the last. Moving a team's cover to another
 * team drops the cover.
 */
export async function curatePost(
  db: Db,
  input: {
    leagueId: LeagueId;
    postId: SocialPostId;
    change: Curation;
    actorId: UserId;
  },
): Promise<Result<void, CurationError>> {
  const [post] = await db
    .select({
      id: socialPost.id,
      accountId: socialPost.accountId,
      featured: socialPost.featured,
      hidden: socialPost.hidden,
      teamId: socialPost.teamId,
      eventId: socialPost.eventId,
      cover: socialPost.cover,
      altText: socialPost.altText,
    })
    .from(socialPost)
    .innerJoin(socialAccount, eq(socialPost.accountId, socialAccount.id))
    .where(
      and(
        eq(socialPost.id, input.postId),
        eq(socialAccount.leagueId, input.leagueId),
      ),
    )
    .for("update", { of: socialPost });
  if (!post) return err("not_found");

  const before = {
    featured: post.featured,
    hidden: post.hidden,
    teamId: post.teamId,
    eventId: post.eventId,
    cover: post.cover,
    altText: post.altText,
  };
  const next = { ...before };
  const { change } = input;
  switch (change.kind) {
    case "feature":
      next.featured = change.on;
      if (change.on) next.hidden = false;
      break;
    case "hide":
      next.hidden = change.on;
      if (change.on) {
        next.featured = false;
        next.cover = null;
      }
      break;
    case "team":
      if (change.teamId) {
        const [found] = await db
          .select({ id: team.id })
          .from(team)
          .where(
            and(eq(team.id, change.teamId), eq(team.leagueId, input.leagueId)),
          );
        if (!found) return err("unknown_team");
      }
      next.teamId = change.teamId;
      if (next.cover === "team" && next.teamId !== before.teamId)
        next.cover = null;
      break;
    case "event":
      if (change.eventId) {
        const [found] = await db
          .select({ id: event.id })
          .from(event)
          .where(
            and(
              eq(event.id, change.eventId),
              eq(event.leagueId, input.leagueId),
              sql`${event.deletedAt} is null`,
            ),
          );
        if (!found) return err("unknown_event");
      }
      next.eventId = change.eventId;
      break;
    case "cover":
      if (change.cover === "team" && !next.teamId)
        return err("cover_needs_team");
      next.cover = change.cover;
      if (change.cover) {
        next.featured = true;
        next.hidden = false;
      }
      break;
    case "alt": {
      const text = change.text.trim();
      if (text.length > 300) return err("alt_too_long");
      next.altText = text || null;
      break;
    }
  }

  // Free the page's cover slot before taking it.
  if (next.cover === "home" && before.cover !== "home")
    await db
      .update(socialPost)
      .set({ cover: null })
      .where(
        and(
          eq(socialPost.accountId, post.accountId),
          eq(socialPost.cover, "home"),
          ne(socialPost.id, post.id),
        ),
      );
  if (
    next.cover === "team" &&
    next.teamId &&
    (before.cover !== "team" || before.teamId !== next.teamId)
  )
    await db
      .update(socialPost)
      .set({ cover: null })
      .where(
        and(
          eq(socialPost.teamId, next.teamId),
          eq(socialPost.cover, "team"),
          ne(socialPost.id, post.id),
        ),
      );
  await db.update(socialPost).set(next).where(eq(socialPost.id, post.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: `instagram.post_${change.kind}`,
    entityType: "social_post",
    entityId: post.id,
    before,
    after: next,
  });

  return ok(undefined);
}

export type PublicPhoto = {
  imageId: SocialImageId;
  permalink: string;
  caption: string | null;
  altText: string | null;
  takenAt: Date;
};

/** Shown on public pages: not hidden, and featured or showing the newest. */
const shown = and(
  eq(socialPost.hidden, false),
  or(eq(socialPost.featured, true), eq(socialAccount.showNewest, true)),
);

const toPhoto = (row: PublicPhoto): PublicPhoto => ({
  imageId: row.imageId,
  permalink: row.permalink,
  caption: row.caption,
  altText: row.altText,
  takenAt: row.takenAt,
});

const PUBLIC_FIELDS = {
  imageId: socialImage.id,
  permalink: socialPost.permalink,
  caption: socialPost.caption,
  altText: socialPost.altText,
  takenAt: socialPost.takenAt,
};

/** The home page's photos: the cover first, then the newest shown posts. */
export async function homePhotos(
  db: Db,
  leagueId: LeagueId,
  limit = 8,
): Promise<{ cover: PublicPhoto | null; photos: PublicPhoto[] }> {
  const rows = await db
    .select({ ...PUBLIC_FIELDS, cover: socialPost.cover })
    .from(socialPost)
    .innerJoin(socialAccount, eq(socialPost.accountId, socialAccount.id))
    .innerJoin(socialImage, eq(socialImage.postId, socialPost.id))
    .where(and(shown, eq(socialAccount.leagueId, leagueId)))
    .orderBy(
      sql`${socialPost.cover} = 'home' desc nulls last`,
      desc(socialPost.takenAt),
    )
    .limit(limit + 1);
  const coverRow = rows.find((r) => r.cover === "home");
  return {
    cover: coverRow ? toPhoto(coverRow) : null,
    photos: rows
      .filter((r) => r !== coverRow)
      .slice(0, limit)
      .map(toPhoto),
  };
}

/** A team page's photos: its cover first, then the newest tagged posts shown. */
export async function teamPhotos(
  db: Db,
  teamId: TeamId,
  limit = 6,
): Promise<{ cover: PublicPhoto | null; photos: PublicPhoto[] }> {
  const rows = await db
    .select({ ...PUBLIC_FIELDS, cover: socialPost.cover })
    .from(socialPost)
    .innerJoin(socialAccount, eq(socialPost.accountId, socialAccount.id))
    .innerJoin(socialImage, eq(socialImage.postId, socialPost.id))
    .where(and(shown, eq(socialPost.teamId, teamId)))
    .orderBy(
      sql`${socialPost.cover} = 'team' desc nulls last`,
      desc(socialPost.takenAt),
    )
    .limit(limit);
  const coverRow = rows.find((r) => r.cover === "team");
  return {
    cover: coverRow ? toPhoto(coverRow) : null,
    photos: rows.filter((r) => r !== coverRow).map(toPhoto),
  };
}

/** An event page's photos: the newest tagged posts shown. */
export async function eventPhotos(
  db: Db,
  eventId: EventId,
  limit = 8,
): Promise<PublicPhoto[]> {
  const rows = await db
    .select(PUBLIC_FIELDS)
    .from(socialPost)
    .innerJoin(socialAccount, eq(socialPost.accountId, socialAccount.id))
    .innerJoin(socialImage, eq(socialImage.postId, socialPost.id))
    .where(and(shown, eq(socialPost.eventId, eventId)))
    .orderBy(desc(socialPost.takenAt))
    .limit(limit);
  return rows.map(toPhoto);
}

/**
 * A stored photo, for its route. `shown` says whether a public page may
 * show it; the admin screen may show any.
 */
export async function storedImage(db: Db, imageId: SocialImageId) {
  const [row] = await db
    .select({
      contentType: socialImage.contentType,
      bytes: socialImage.bytes,
      sha256: socialImage.sha256,
      shown: sql<boolean>`coalesce(${shown}, false)`,
      leagueId: socialAccount.leagueId,
    })
    .from(socialImage)
    .innerJoin(socialPost, eq(socialImage.postId, socialPost.id))
    .innerJoin(socialAccount, eq(socialPost.accountId, socialAccount.id))
    .where(eq(socialImage.id, imageId));
  return row ?? null;
}

/** Whether any account is waiting for an admin to reconnect, for the dashboard. */
export async function needsReconnect(db: Db, leagueId: LeagueId) {
  const [row] = await db
    .select({ username: socialAccount.username })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.leagueId, leagueId),
        eq(socialAccount.status, "needs_reconnect"),
        isNotNull(socialAccount.username),
      ),
    );
  return row ?? null;
}
