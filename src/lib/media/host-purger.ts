import { HOST_PURGE_READY } from "./optimizer-cache";

/**
 * Clears cached copies of photos (ADR 0068). `byTag` clears the CDN's copy
 * of each photo's own address (tagged by `photoCacheHeaders`), `bySrcImage`
 * every resized copy the image optimizer made from it. Both must delete, not
 * mark stale: a stale copy would be served once more while the host fetched
 * the 404 in the background.
 */
export type PhotoCachePurger = {
  byTag(tags: string[]): Promise<void>;
  bySrcImage(srcs: string[]): Promise<void>;
};

/** Fills in with the package's two calls when it is added. */
const vercelPurger: PhotoCachePurger | null = null;

/**
 * The host's purge: the one place that talks to the host's cache, so the
 * way it purges can change here alone. Until `HOST_PURGE_READY` is on there
 * is none, and optimized copies keep the photo's own five minutes
 * (`optimizedPhotoLifetime`), so a takedown needs no purge.
 *
 * Turning it on (ADR 0068): with the `@vercel/functions` package, `byTag`
 * calls `dangerouslyDeleteByTag(tags, { revalidationDeadlineSeconds: 0 })`
 * and `bySrcImage` calls `dangerouslyDeleteBySrcImage` the same way; then
 * `HOST_PURGE_READY` becomes true.
 */
export function hostPurger(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PhotoCachePurger | null {
  return HOST_PURGE_READY && env.VERCEL === "1" ? vercelPurger : null;
}
