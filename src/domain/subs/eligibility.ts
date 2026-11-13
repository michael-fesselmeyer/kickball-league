/**
 * The sub finder's rules (product-spec.md: "Subs must be registered players
 * with a signed waiver, and sub requests are disabled for playoff games").
 *
 * - A request is for one upcoming, placed, non-playoff game.
 * - A sub is registered this season with the waiver signed, is not
 *   suspended, is not on either team in the game, and is not playing or
 *   refereeing another game at an overlapping time.
 * - A request can reserve spots for women or men, for the fielding rule.
 *   A claim holds a spot until the captain answers, so the spots left are
 *   the spots asked for minus claims that are pending or approved.
 */

import type { FieldingRules } from "../rsvp/fielding";
import { RULEBOOK } from "../rsvp/fielding";
import { err, ok, type Result } from "../result";

export type LineupGender = "woman" | "man";

export type GameKind = "regular" | "playoff" | "exhibition";

export type SubGame = {
  kind: GameKind;
  status: string;
  teamSeasonIds: readonly [string, string];
  /** Null while the game has no slot on the published schedule. */
  startsAt: Date | null;
  endsAt: Date | null;
};

export type PostBlock = "playoff" | "not_placed" | "game_over" | "started";

/** Whether a captain may ask for subs for `game` at `now`. */
export function canPostFor(
  game: SubGame,
  now: Date,
): Result<{ closesAt: Date }, PostBlock> {
  if (game.kind === "playoff") return err("playoff");
  if (["final", "forfeit", "cancelled"].includes(game.status))
    return err("game_over");
  if (game.status === "in_progress") return err("started");
  if (game.status === "postponed" || !game.startsAt) return err("not_placed");
  if (game.startsAt <= now) return err("started");
  return ok({ closesAt: game.startsAt });
}

export type RegistrationStatus =
  | "pending_waiver"
  | "pending_payment"
  | "active"
  | "waitlisted"
  | "cancelled"
  | "refunded";

export type SubCandidate = {
  /** This season's registration, or null for someone not registered. */
  registration: {
    kind: "team_member" | "free_agent";
    status: RegistrationStatus;
  } | null;
  /** The team they are active on this season, if any. */
  teamSeasonId: string | null;
  lineupGender: LineupGender | null;
  /** Other games this season they play in or referee, by time. */
  commitments: readonly { startsAt: Date; endsAt: Date }[];
  /** Suspended by the league right now (src/domain/discipline). */
  suspended?: boolean;
};

export type Ineligible =
  "not_registered" | "waiver_unsigned" | "suspended" | "plays_in_game" | "busy";

/** Statuses that mean registered with the waiver signed. */
const SIGNED: readonly RegistrationStatus[] = ["pending_payment", "active"];

const overlaps = (
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Whether `person` may sub in `game` at all, before counting spots. */
export function checkEligibility(
  person: SubCandidate,
  game: SubGame,
): Result<void, Ineligible> {
  const r = person.registration;
  if (!r || ["waitlisted", "cancelled", "refunded"].includes(r.status))
    return err("not_registered");
  if (!SIGNED.includes(r.status)) return err("waiver_unsigned");
  if (person.suspended === true) return err("suspended");
  if (person.teamSeasonId && game.teamSeasonIds.includes(person.teamSeasonId))
    return err("plays_in_game");
  const { startsAt, endsAt } = game;
  if (
    startsAt &&
    endsAt &&
    person.commitments.some((c) => overlaps(c, { startsAt, endsAt }))
  )
    return err("busy");
  return ok(undefined);
}

/** A free agent has no team this season; they hear about requests first. */
export const isFreeAgent = (person: SubCandidate) =>
  person.teamSeasonId === null;

export type Spots = { needed: number; womenNeeded: number; menNeeded: number };

/** Claims that hold a spot (pending or approved), by lineup gender. */
export type Held = { women: number; men: number; unknown: number };

export const NOBODY: Held = { women: 0, men: 0, unknown: 0 };

export type OpenSpots = {
  /** Spots nobody holds yet. */
  left: number;
  /** Of those, how many only a woman can take, and only a man. */
  women: number;
  men: number;
};

export function openSpots(spots: Spots, held: Held): OpenSpots {
  const left = Math.max(0, spots.needed - held.women - held.men - held.unknown);
  const women = Math.max(0, spots.womenNeeded - held.women);
  const men = Math.max(0, spots.menNeeded - held.men);
  return { left, women: Math.min(women, left), men: Math.min(men, left) };
}

/**
 * Whether one more claim from someone of `gender` fits: there is a spot
 * left, and taking it still leaves room for the spots reserved for others.
 * A player with no lineup gender set can take only an unreserved spot.
 */
export function hasSpotFor(
  spots: Spots,
  held: Held,
  gender: LineupGender | null,
): boolean {
  const open = openSpots(spots, held);
  if (open.left === 0) return false;
  if (gender === "woman" && open.women > 0) return true;
  if (gender === "man" && open.men > 0) return true;
  return open.left - 1 >= open.women + open.men;
}

/** Adds one claim to the held counts. */
export const hold = (held: Held, gender: LineupGender | null): Held => ({
  women: held.women + (gender === "woman" ? 1 : 0),
  men: held.men + (gender === "man" ? 1 : 0),
  unknown: held.unknown + (gender === null ? 1 : 0),
});

/**
 * What a captain should ask for to field a full lineup, given who is
 * coming: the women and men the fielding rule needs, and any more of either.
 * Players with no lineup gender are not counted, as in the RSVP check.
 */
export function suggestSubs(
  coming: { women: number; men: number },
  rules: FieldingRules = RULEBOOK,
): Spots {
  // At most maxPerGender of one gender, so the other must make up the rest.
  const each = Math.max(0, rules.maxFielders - rules.maxPerGender);
  const womenNeeded = Math.max(0, each - coming.women);
  const menNeeded = Math.max(0, each - coming.men);
  const fielded =
    Math.min(coming.women + womenNeeded, rules.maxPerGender) +
    Math.min(coming.men + menNeeded, rules.maxPerGender);
  const extra = Math.max(0, rules.maxFielders - fielded);
  return { needed: womenNeeded + menNeeded + extra, womenNeeded, menNeeded };
}

/** "2 subs, at least 1 woman", for emails and lists. */
export function describeSpots(spots: Spots): string {
  const n = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  const reserved = [
    spots.womenNeeded > 0 ? n(spots.womenNeeded, "woman", "women") : null,
    spots.menNeeded > 0 ? n(spots.menNeeded, "man", "men") : null,
  ].filter((part) => part !== null);
  const total = n(spots.needed, "sub", "subs");
  return reserved.length === 0
    ? total
    : `${total}, at least ${reserved.join(" and ")}`;
}
