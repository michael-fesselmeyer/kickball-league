import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  fitUnderCap,
  KEEP_RECENT,
  postsToKeep,
  STORAGE_CAP_BYTES,
} from "./storage";

const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 60_000);
const post = (
  n: number,
  curated: Partial<{ featured: boolean; cover: string }> = {},
) => ({
  externalId: `p${n}`,
  takenAt: at(n),
  featured: curated.featured ?? false,
  cover: curated.cover ?? null,
});

describe("postsToKeep", () => {
  it("keeps the 30 newest and every curated post", () => {
    const posts = Array.from({ length: 40 }, (_, i) => post(i));
    posts[0] = post(0, { featured: true });
    posts[1] = post(1, { cover: "home" });
    const keep = postsToKeep(posts);
    expect(KEEP_RECENT).toBe(30);
    expect(keep.size).toBe(32);
    expect(keep.has("p39")).toBe(true);
    expect(keep.has("p10")).toBe(true);
    expect(keep.has("p9")).toBe(false);
    expect(keep.has("p0")).toBe(true);
    expect(keep.has("p1")).toBe(true);
  });

  it("never keeps more than the newest plus the curated", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            n: fc.integer({ min: 0, max: 10_000 }),
            featured: fc.boolean(),
            cover: fc.constantFrom(null, "home", "team"),
          }),
          { maxLength: 80 },
        ),
        (rows) => {
          const posts = rows.map((r, i) => ({
            externalId: `p${i}`,
            takenAt: at(r.n),
            featured: r.featured,
            cover: r.cover,
          }));
          const keep = postsToKeep(posts, 5);
          const curated = posts.filter((p) => p.featured || p.cover);
          expect(keep.size).toBeLessThanOrEqual(5 + curated.length);
          for (const p of curated) expect(keep.has(p.externalId)).toBe(true);
        },
      ),
    );
  });
});

describe("fitUnderCap", () => {
  const photo = (n: number, size: number) => ({ takenAt: at(n), size });

  it("takes the newest photos first and says when it is full", () => {
    const result = fitUnderCap(
      80,
      [photo(1, 10), photo(3, 15), photo(2, 15)],
      100,
    );
    expect(result.accepted.map((p) => p.takenAt)).toEqual([at(3)]);
    expect(result.full).toBe(true);
  });

  it("lets a smaller photo in after a large one that doesn't fit", () => {
    const result = fitUnderCap(90, [photo(2, 50), photo(1, 10)], 100);
    expect(result.accepted.map((p) => p.size)).toEqual([10]);
    expect(result.full).toBe(true);
  });

  it("is not full when everything fits", () => {
    expect(fitUnderCap(0, [photo(1, 10)], 100)).toEqual({
      accepted: [photo(1, 10)],
      full: false,
    });
  });

  it("never goes past the cap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: STORAGE_CAP_BYTES }),
        fc.array(fc.integer({ min: 1, max: 3 * 1024 * 1024 }), {
          maxLength: 40,
        }),
        (used, sizes) => {
          const { accepted } = fitUnderCap(
            used,
            sizes.map((size, i) => photo(i, size)),
          );
          const total = used + accepted.reduce((sum, p) => sum + p.size, 0);
          expect(total).toBeLessThanOrEqual(STORAGE_CAP_BYTES);
        },
      ),
    );
  });
});
