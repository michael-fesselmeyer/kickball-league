import {
  dangerouslyDeleteBySrcImage,
  dangerouslyDeleteByTag,
} from "@vercel/functions";
import type { Db } from "@/db/queries/schedule";
import { approvedPhotoIds } from "@/db/queries/member-photos";
import { shopImageIds } from "@/db/queries/merch";
import { shownImageIds } from "@/db/queries/social";
import { logError } from "@/lib/log-error";
import { photoSrc } from "./photo-src";

/**
 * Clears cached copies of photos (ADR 0068). `byTag` clears the CDN's copy
 * of each photo's own address (tagged by `photoCacheHeaders`), `bySrcImage`
 * every resized copy the image optimizer made from it.
 */
export type PhotoCachePurger = {
  byTag(tags: string[]): Promise<void>;
  bySrcImage(srcs: string[]): Promise<void>;
};

/**
 * Deleted, not marked stale: a stale copy would be served once more while
 * the host fetched the 404 in the background. With no grace period the
 * next request waits for the photo's address, which already answers 404.
 */
const DELETE_NOW = { revalidationDeadlineSeconds: 0 };

const vercelPurger: PhotoCachePurger = {
  byTag: (tags) => dangerouslyDeleteByTag(tags, DELETE_NOW),
  bySrcImage: (srcs) => dangerouslyDeleteBySrcImage(srcs, DELETE_NOW),
};

/**
 * The host's purge, only on Vercel. Elsewhere optimized copies keep the
 * photo's own five minutes (`optimizedPhotoLifetime`), so nothing needs it.
 */
export function hostPurger(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PhotoCachePurger | null {
  return env.VERCEL === "1" ? vercelPurger : null;
}

/** The host's purge API takes at most this many tags or images a call. */
const PURGE_BATCH = 16;

/** How long to wait before the one retry of a refused purge. */
const RETRY_AFTER_MS = 1000;

/**
 * Purges every cached copy of these photo addresses: the CDN's copy of the
 * address first, so the optimizer cannot fetch it again, then the
 * optimizer's copies. A refused call (the host allows 50 a second) is tried
 * once more; a second failure is logged, never thrown: the takedown itself
 * has happened, and its pages already dropped the photo (ADR 0068 says how
 * an admin clears the copies by hand then).
 */
export async function purgePhotoCopies(
  srcs: Iterable<string>,
  purger: PhotoCachePurger | null = hostPurger(),
  retryAfterMs = RETRY_AFTER_MS,
): Promise<void> {
  const list = [...new Set(srcs)].sort();
  if (!purger || list.length === 0) return;
  const once = async (batch: string[]) => {
    await purger.byTag(batch);
    await purger.bySrcImage(batch);
  };
  for (let i = 0; i < list.length; i += PURGE_BATCH) {
    const batch = list.slice(i, i + PURGE_BATCH);
    try {
      await once(batch);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      try {
        await once(batch);
      } catch (error) {
        logError("photo cache purge failed", error, ...batch);
      }
    }
  }
}

/** Every photo address a public page may show now, in every league. */
export async function publicPhotoSrcs(db: Db): Promise<Set<string>> {
  const [instagram, member, merch] = await Promise.all([
    shownImageIds(db),
    approvedPhotoIds(db),
    shopImageIds(db),
  ]);
  return new Set([
    ...instagram.map(photoSrc.instagram),
    ...member.map(photoSrc.member),
    ...merch.map(photoSrc.merch),
  ]);
}

/**
 * What a change to photos needs to purge: photos that stopped being public
 * (their copies must go) and photos that became public again (a cached 404
 * from while they were hidden must go).
 */
export function changedSrcs(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): string[] {
  return [
    ...[...before].filter((src) => !after.has(src)),
    ...[...after].filter((src) => !before.has(src)),
  ];
}

/**
 * Around any action that can take a photo down (hide, unfeature, reject an
 * approved photo, delete, sync away, hide a merch item): read the public
 * photos before, run the change, then purge the ones that changed. Off
 * Vercel there is nothing to purge, so nothing is read.
 */
export async function purgingPhotoChanges<T>(
  db: Db,
  change: () => Promise<T>,
  purger: PhotoCachePurger | null = hostPurger(),
): Promise<T> {
  if (!purger) return change();
  const before = await publicPhotoSrcs(db);
  const result = await change();
  const after = await publicPhotoSrcs(db);
  await purgePhotoCopies(changedSrcs(before, after), purger);
  return result;
}
