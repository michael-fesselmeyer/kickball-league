/**
 * The team waitlist (product-spec.md, "Waitlist for full seasons, with timed
 * offers"). Pure: the caller counts the teams and offers.
 *
 * Rules:
 * - Captains wait in the order they joined.
 * - When a spot opens, the next one is offered it for OFFER_HOURS. A live
 *   offer holds the spot; nobody else can take it.
 * - While anyone is waiting, a newcomer joins the line instead of
 *   registering, so nobody jumps it.
 */

export const OFFER_HOURS = 48;

export type OfferLike = {
  status: string;
  offerExpiresAt: Date | null;
};

/** An offer counts until its time runs out, even before a job marks it. */
export function offerIsLive(entry: OfferLike, now: Date): boolean {
  return (
    entry.status === "offered" &&
    entry.offerExpiresAt !== null &&
    now < entry.offerExpiresAt
  );
}

export function offerExpiry(now: Date): Date {
  return new Date(now.getTime() + OFFER_HOURS * 3_600_000);
}

export type SeasonSpots = {
  /** Null when the season has no team limit. */
  maxTeams: number | null;
  /** Teams entered and not withdrawn or waitlisted. */
  entered: number;
  /** Live offers held by people on the waitlist. */
  liveOffers: number;
  /** People still waiting, not yet offered. */
  waiting: number;
};

/** Spots nobody has and nobody is holding. */
export function freeSpots(s: SeasonSpots): number {
  if (s.maxTeams === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, s.maxTeams - s.entered - s.liveOffers);
}

/** How many new offers to send now: one per free spot, in line order. */
export function offersToSend(s: SeasonSpots): number {
  if (s.maxTeams === null) return 0;
  return Math.min(freeSpots(s), s.waiting);
}

/**
 * Whether this person may register a team now. Someone holding a live offer
 * may, as long as the spot they hold is still there. Anyone else needs a
 * free spot with nobody waiting ahead of them.
 */
export function mayRegisterTeam(
  s: SeasonSpots,
  holdsLiveOffer: boolean,
): boolean {
  if (s.maxTeams === null) return true;
  if (holdsLiveOffer)
    // Their own offer is one of the live ones; it holds a spot for them.
    return s.maxTeams - s.entered - (s.liveOffers - 1) > 0;
  return freeSpots(s) > 0 && s.waiting === 0;
}
