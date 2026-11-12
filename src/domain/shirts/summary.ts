/**
 * Shirt tracking (product-spec.md, section 6): how many of each size a team
 * needs, how many are ordered and received, and what is still to order for
 * late joiners. Sizes come from the player's profile; the status is the
 * registration's shirt_status for the season.
 */

export const SHIRT_SIZES = ["xs", "s", "m", "l", "xl", "xxl"] as const;
export type ShirtSize = (typeof SHIRT_SIZES)[number];
export const SHIRT_STATUSES = ["none", "ordered", "received"] as const;
export type ShirtStatus = (typeof SHIRT_STATUSES)[number];

export const SHIRT_STATUS_LABEL: Record<ShirtStatus, string> = {
  none: "Not ordered",
  ordered: "Ordered",
  received: "Received",
};

/** "xs" → "XS"; a missing size reads "No size". */
export const sizeLabel = (size: ShirtSize | null) =>
  size === null ? "No size" : size.toUpperCase();

export type ShirtCounts = {
  /** Players per size; `unknown` is players with no size on their profile. */
  bySize: Record<ShirtSize, number>;
  unknown: number;
  total: number;
  ordered: number;
  received: number;
  /** Not ordered yet, per size: the order list for late joiners. */
  toOrder: Record<ShirtSize, number>;
  toOrderUnknown: number;
};

const zeroes = (): Record<ShirtSize, number> => ({
  xs: 0,
  s: 0,
  m: 0,
  l: 0,
  xl: 0,
  xxl: 0,
});

export function countShirts(
  players: readonly { size: ShirtSize | null; status: ShirtStatus }[],
): ShirtCounts {
  const counts: ShirtCounts = {
    bySize: zeroes(),
    unknown: 0,
    total: players.length,
    ordered: 0,
    received: 0,
    toOrder: zeroes(),
    toOrderUnknown: 0,
  };
  for (const p of players) {
    if (p.size === null) counts.unknown++;
    else counts.bySize[p.size]++;
    if (p.status === "ordered") counts.ordered++;
    if (p.status === "received") counts.received++;
    if (p.status === "none") {
      if (p.size === null) counts.toOrderUnknown++;
      else counts.toOrder[p.size]++;
    }
  }
  return counts;
}

/** Whether a form value is a shirt status. */
export const isShirtStatus = (value: unknown): value is ShirtStatus =>
  typeof value === "string" &&
  (SHIRT_STATUSES as readonly string[]).includes(value);
