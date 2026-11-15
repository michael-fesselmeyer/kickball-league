import {
  dangerouslyDeleteBySrcImage,
  dangerouslyDeleteByTag,
} from "@vercel/functions";
import { HOST_PURGE_READY } from "./optimizer-cache";

/**
 * Clears cached copies of photos (ADR 0069). `byTag` clears the CDN's copy
 * of each photo's own address (tagged by `photoCacheHeaders`), `bySrcImage`
 * every resized copy the image optimizer made from it.
 */
export type PhotoCachePurger = {
  byTag(tags: string[]): Promise<void>;
  bySrcImage(srcs: string[]): Promise<void>;
};

/**
 * Deleted, not marked stale: a stale copy would be served once more while
 * the host fetched the 404 in the background. With no grace period the next
 * request waits for the photo's address, which already answers 404.
 */
const DELETE_NOW = { revalidationDeadlineSeconds: 0 };

const vercelPurger: PhotoCachePurger = {
  byTag: (tags) => dangerouslyDeleteByTag(tags, DELETE_NOW),
  bySrcImage: (srcs) => dangerouslyDeleteBySrcImage(srcs, DELETE_NOW),
};

/**
 * The host's purge: the one place that talks to the host's cache, so the
 * way it purges can change here alone. Only on Vercel, through the
 * deployment's own access (no API token). Anywhere else, or with
 * `HOST_PURGE_READY` off, there is none, and optimized copies keep the
 * photo's own five minutes (`optimizedPhotoLifetime`), so a takedown needs
 * no purge.
 */
export function hostPurger(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PhotoCachePurger | null {
  return HOST_PURGE_READY && env.VERCEL === "1" ? vercelPurger : null;
}
