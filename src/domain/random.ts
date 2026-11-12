/**
 * A small seeded random number generator (mulberry32). The same seed always
 * produces the same sequence, so seed data is reproducible and testable.
 */
export type Random = {
  /** A float in [0, 1). */
  next: () => number;
  /** An integer in [min, max], inclusive. */
  int: (min: number, max: number) => number;
  /** One item from a non-empty list. */
  pick: <T>(items: readonly T[]) => T;
  /** A shuffled copy. */
  shuffle: <T>(items: readonly T[]) => T[];
};

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("pick() needs at least one item");
    return items[int(0, items.length - 1)] as T;
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  };
  return { next, int, pick, shuffle };
}
