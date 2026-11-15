import type { Db } from "@/db/queries/schedule";
import { approvedPhotoIds } from "@/db/queries/member-photos";
import { shopImageIds } from "@/db/queries/merch";
import {
  duePurges,
  type PhotoPurge,
  recordFailedPurges,
  recordRetriedPurges,
} from "@/db/queries/photo-purges";
import { shownImageIds } from "@/db/queries/social";
import type { LeagueId } from "@/domain/ids";
import { logError } from "@/lib/log-error";
import { hostPurger, type PhotoCachePurger } from "./host-purger";
import { LONG_PHOTO_LIFETIME } from "./optimizer-cache";
import { photoSrc } from "./photo-src";

export type { PhotoCachePurger };

/** The host's purge API takes at most this many tags or images a call. */
const PURGE_BATCH = 16;

/** How long to wait before the one retry of a refused purge. */
const RETRY_AFTER_MS = 1000;

/**
 * Purges every cached copy of these photo addresses: the CDN's copy of the
 * address first, so the optimizer cannot fetch it again, then the
 * optimizer's copies. A refused call (the host allows 50 a second) is tried
 * once more; a second failure is logged and returned, never thrown: the
 * takedown itself has happened, and its pages already dropped the photo.
 * The caller records it for the daily retry (`retryFailedPurges`).
 */
export async function purgePhotoCopies(
  srcs: Iterable<string>,
  purger: PhotoCachePurger | null = hostPurger(),
  retryAfterMs = RETRY_AFTER_MS,
): Promise<string[]> {
  const list = [...new Set(srcs)].sort();
  const failed: string[] = [];
  if (!purger || list.length === 0) return failed;
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
        failed.push(...batch);
      }
    }
  }
  return failed;
}

/** Every photo a public page may show now, in every league, by address. */
export type PublicPhotos = ReadonlyMap<string, LeagueId>;

/** Every photo address a public page may show now, with its league. */
export async function publicPhotoSrcs(db: Db): Promise<PublicPhotos> {
  const [instagram, member, merch] = await Promise.all([
    shownImageIds(db),
    approvedPhotoIds(db),
    shopImageIds(db),
  ]);
  return new Map([
    ...instagram.map((p) => [photoSrc.instagram(p.id), p.leagueId] as const),
    ...member.map((p) => [photoSrc.member(p.id), p.leagueId] as const),
    ...merch.map((p) => [photoSrc.merch(p.id), p.leagueId] as const),
  ]);
}

/**
 * What a change to photos needs to purge: photos that stopped being public
 * (their copies must go) and photos that became public again (a cached 404
 * from while they were hidden must go).
 */
export function changedSrcs(
  before: PublicPhotos,
  after: PublicPhotos,
): PhotoPurge[] {
  return [
    ...[...before].filter(([src]) => !after.has(src)),
    ...[...after].filter(([src]) => !before.has(src)),
  ].map(([src, leagueId]) => ({ src, leagueId }));
}

/**
 * Records purges that failed for the daily retry. A failure to record is
 * logged, never thrown, for the same reason a failed purge is.
 */
async function recordFailures(db: Db, failures: PhotoPurge[]) {
  if (failures.length === 0) return;
  try {
    await recordFailedPurges(db, failures);
  } catch (error) {
    logError(
      "photo cache purge not recorded",
      error,
      ...failures.map((f) => f.src),
    );
  }
}

/**
 * Around any action that can take a photo down (hide, unfeature, reject an
 * approved photo, delete, sync away, hide a merch item): read the public
 * photos before, run the change, then purge the ones that changed. Off
 * Vercel there is nothing to purge, so nothing is read. A purge that fails
 * is recorded in the photo's league's audit log for the daily retry.
 */
export async function purgingPhotoChanges<T>(
  db: Db,
  change: () => Promise<T>,
  purger: PhotoCachePurger | null = hostPurger(),
  retryAfterMs = RETRY_AFTER_MS,
): Promise<T> {
  if (!purger) return change();
  const before = await publicPhotoSrcs(db);
  const result = await change();
  const after = await publicPhotoSrcs(db);
  const changed = changedSrcs(before, after);
  const failed = new Set(
    await purgePhotoCopies(
      changed.map((c) => c.src),
      purger,
      retryAfterMs,
    ),
  );
  await recordFailures(
    db,
    changed.filter((c) => failed.has(c.src)),
  );
  return result;
}

/**
 * The daily job's half: tries every recorded failure again (`duePurges`),
 * and records each one that gets through, so admins see it cleared. One
 * that fails again stays due until the optimizer's copies would have
 * expired on their own, 31 days after it first failed.
 */
export async function retryFailedPurges(
  db: Db,
  now: Date,
  purger: PhotoCachePurger | null = hostPurger(),
  retryAfterMs = RETRY_AFTER_MS,
): Promise<{ purged: number; stillFailing: number }> {
  if (!purger) return { purged: 0, stillFailing: 0 };
  const due = await duePurges(db, now, LONG_PHOTO_LIFETIME);
  const failed = new Set(
    await purgePhotoCopies(
      due.map((d) => d.src),
      purger,
      retryAfterMs,
    ),
  );
  const purged = due.filter((d) => !failed.has(d.src));
  await recordRetriedPurges(db, purged);
  return { purged: purged.length, stillFailing: failed.size };
}
