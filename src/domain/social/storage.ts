/**
 * How much of the league's Instagram the site keeps (ADR 0023), so the
 * copies stay inside the database's free tier, which every other table
 * shares.
 *
 * - The 30 newest posts, plus every post an admin featured or made a cover.
 *   Older ones are deleted with their photo at each sync.
 * - At most 25 MB of photos in all. A sync that would go past it copies
 *   what fits, newest first, and tells admins; nothing already shown is
 *   ever deleted to make room.
 */
export const KEEP_RECENT = 30;
export const STORAGE_CAP_BYTES = 25 * 1024 * 1024;

export type KeptPost = {
  externalId: string;
  takenAt: Date;
  featured: boolean;
  cover: string | null;
};

const isCurated = (p: KeptPost) => p.featured || p.cover !== null;

/** The external ids to keep: the newest `keepRecent`, plus curated ones. */
export function postsToKeep(
  posts: readonly KeptPost[],
  keepRecent = KEEP_RECENT,
): Set<string> {
  const newest = [...posts]
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
    .slice(0, keepRecent);
  return new Set([
    ...newest.map((p) => p.externalId),
    ...posts.filter(isCurated).map((p) => p.externalId),
  ]);
}

/**
 * Which new photos fit under the cap, newest first: each is taken while
 * the total stays at or under `cap`, so a large photo that doesn't fit
 * never blocks a smaller one after it. `full` says something was left out.
 */
export function fitUnderCap<P extends { takenAt: Date; size: number }>(
  usedBytes: number,
  candidates: readonly P[],
  cap = STORAGE_CAP_BYTES,
): { accepted: P[]; full: boolean } {
  let used = usedBytes;
  const accepted: P[] = [];
  let full = false;
  for (const c of [...candidates].sort(
    (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
  )) {
    if (used + c.size > cap) {
      full = true;
      continue;
    }
    accepted.push(c);
    used += c.size;
  }
  return { accepted, full };
}
