/**
 * What one Instagram sync changes (docs/architecture.md, section 17).
 *
 * A sync reads only the most recent posts, so a stored post missing from
 * that page has either been deleted on Instagram or is simply older than
 * the page. Only posts at least as new as the oldest one read can be told
 * apart: those are deleted. When the page held the whole account
 * (`complete`), every missing post is deleted.
 */

export type FetchedPost = { externalId: string; takenAt: Date };
export type StoredPost = { externalId: string; takenAt: Date };

export type SyncPlan<P extends FetchedPost> = {
  /** New posts: their photos are copied, then they are inserted. */
  add: P[];
  /** Posts already stored: caption and link are refreshed, curation kept. */
  update: P[];
  /** Deleted on Instagram: removed with their photos. */
  remove: string[];
};

export function planSync<P extends FetchedPost>(
  stored: readonly StoredPost[],
  fetched: readonly P[],
  complete: boolean,
): SyncPlan<P> {
  const storedIds = new Set(stored.map((s) => s.externalId));
  const fetchedIds = new Set(fetched.map((f) => f.externalId));
  const oldest = fetched.reduce<number | null>(
    (min, f) =>
      min === null ? f.takenAt.getTime() : Math.min(min, f.takenAt.getTime()),
    null,
  );
  const remove = stored
    .filter((s) => !fetchedIds.has(s.externalId))
    .filter(
      (s) => complete || (oldest !== null && s.takenAt.getTime() >= oldest),
    )
    .map((s) => s.externalId);
  return {
    add: fetched.filter((f) => !storedIds.has(f.externalId)),
    update: fetched.filter((f) => storedIds.has(f.externalId)),
    remove,
  };
}

/**
 * Whether a post shows on public pages: never when hidden; otherwise once
 * an admin features it, or straight away when the league shows the newest
 * posts automatically.
 */
export const isShown = (
  post: { hidden: boolean; featured: boolean },
  showNewest: boolean,
): boolean => !post.hidden && (post.featured || showNewest);

/** Alt text for a photo: the admin's words, else the caption's first line. */
export function altFor(post: {
  altText: string | null;
  caption: string | null;
}): string {
  const own = post.altText?.trim();
  if (own) return own;
  const line = post.caption?.split("\n")[0]?.trim();
  if (!line) return "A photo from the league's Instagram";
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}
