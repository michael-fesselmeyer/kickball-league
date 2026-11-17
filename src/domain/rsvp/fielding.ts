/**
 * The fielding rule, for a captain planning from RSVPs (rulebook 2.3;
 * open question 4).
 *
 * - On defense: at most 11 fielders, and at most 6 of any gender.
 * - Short-handed, the rulebook lists 9 (4 and 5) and 7 (4 and 3).
 * - Fewer than 7 is a forfeit, unless the team picks up registered players
 *   to make up the difference. Pickups are not allowed in playoff games.
 * - Pickups never make up for the team's own players: a game counts only
 *   if at least 6 of the team's own players are there. Below that it is a
 *   forfeit, though the teams may still play a pickup game.
 * - Anything else the counts allow, such as 6 and 1, is legal but outside
 *   the listed lineups, so the captain should check with the ref.
 *
 * The site warns; it never blocks a game (product-spec.md, section 7).
 */

export type FieldingRules = {
  maxFielders: number;
  maxPerGender: number;
  minimumToPlay: number;
  /** The team's own players a game needs to count; pickups don't add to it. */
  minimumOwnPlayers: number;
};

export const RULEBOOK: FieldingRules = {
  maxFielders: 11,
  maxPerGender: 6,
  minimumToPlay: 7,
  minimumOwnPlayers: 6,
};

/** A season's saved fielding numbers, with the rulebook's for any it leaves out. */
export function fieldingRulesOf(
  saved: Partial<FieldingRules> | null | undefined,
): FieldingRules {
  return {
    maxFielders: saved?.maxFielders ?? RULEBOOK.maxFielders,
    maxPerGender: saved?.maxPerGender ?? RULEBOOK.maxPerGender,
    minimumToPlay: saved?.minimumToPlay ?? RULEBOOK.minimumToPlay,
    minimumOwnPlayers: saved?.minimumOwnPlayers ?? RULEBOOK.minimumOwnPlayers,
  };
}

/** The short-handed lineups the rulebook names, as [larger, smaller] groups. */
const LISTED_SHORT: readonly (readonly [number, number])[] = [
  [5, 4],
  [4, 3],
];

export type FieldingLevel = "full" | "short" | "check" | "forfeit";

export type FieldingCheck = {
  /** The most players who can take the field within the gender limit. */
  fielders: number;
  level: FieldingLevel;
  message: string;
};

/**
 * What a team can field from its own players who said they are in. Players
 * whose fielding group is unknown are left out of the fielders, and the
 * message says so; they still count as the team's own players. Pickups are
 * allowed unless the game is a playoff game.
 */
export function checkFielding(
  counts: { women: number; men: number; unknown?: number },
  rules: FieldingRules = RULEBOOK,
  { pickupsAllowed = true }: { pickupsAllowed?: boolean } = {},
): FieldingCheck {
  const own = counts.women + counts.men + (counts.unknown ?? 0);
  const women = Math.min(counts.women, rules.maxPerGender);
  const men = Math.min(counts.men, rules.maxPerGender);
  const fielders = Math.min(women + men, rules.maxFielders);
  const unknown =
    counts.unknown && counts.unknown > 0
      ? ` ${counts.unknown} more ${counts.unknown === 1 ? "has" : "have"} not set a fielding group in their profile.`
      : "";
  const [more, fewer] = women >= men ? [women, men] : [men, women];

  if (own < rules.minimumOwnPlayers)
    return {
      fielders,
      level: "forfeit",
      message: `Only ${own} of the team's own ${own === 1 ? "player is" : "players are"} in. A game counts only with at least ${rules.minimumOwnPlayers} of a team's own players, and pickups don't count toward that, so this is a forfeit. The teams can still play a pickup game.`,
    };
  if (fielders >= rules.maxFielders)
    return {
      fielders,
      level: "full",
      message: `A full ${rules.maxFielders} on defense.${unknown}`,
    };
  if (fielders < rules.minimumToPlay) {
    const short = rules.minimumToPlay - fielders;
    const pickups = pickupsAllowed
      ? ` Pick up ${short === 1 ? "1 registered player" : `${short} registered players`} to play, or it's a forfeit.`
      : " Playoff games can't use pickups.";
    return {
      fielders,
      level: "forfeit",
      message: `Only ${fielders} can take the field within the rule (at most ${rules.maxPerGender} of any gender). Fewer than ${rules.minimumToPlay} is a forfeit.${pickups}${unknown}`,
    };
  }
  const listed = LISTED_SHORT.find(([a, b]) => more >= a && fewer >= b);
  if (listed) {
    // Say why: the smaller group is too few, or too few are in at all.
    const [moreSide, fewerSide] =
      women >= men ? (["women", "men"] as const) : (["men", "women"] as const);
    const why =
      fewer < rules.maxFielders - rules.maxPerGender
        ? `only ${fewer} ${group(fewerSide, fewer)} ${fewer === 1 ? "is" : "are"} in`
        : `${women + men} are in`;
    return {
      fielders,
      level: "short",
      message: `Short-handed: ${why}, so you can field ${listed[0] + listed[1]} (${listed[0]} ${group(moreSide, listed[0])} and ${listed[1]} ${group(fewerSide, listed[1])}), a lineup the rulebook allows.${unknown}`,
    };
  }
  return {
    fielders,
    level: "check",
    message: `${fielders} can take the field (${more} and ${fewer}), which is outside the rulebook's listed lineups. Check with the ref.${unknown}`,
  };
}

/** "women" or "woman", "men" or "man", for a count. */
function group(side: "women" | "men", n: number): string {
  if (n !== 1) return side;
  return side === "women" ? "woman" : "man";
}
