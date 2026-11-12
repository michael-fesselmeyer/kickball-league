/**
 * The fielding rule, for a captain planning from RSVPs (rulebook 2.3;
 * open question 4).
 *
 * - On defense: at most 11 fielders, and at most 6 of any gender.
 * - Short-handed, the rulebook lists 9 (4 and 5) and 7 (4 and 3).
 * - Fewer than 7 is a forfeit.
 * - Anything else the counts allow, such as 6 and 1, is legal but outside
 *   the listed lineups, so the captain should check with the ref.
 *
 * The site warns; it never blocks a game (product-spec.md, section 7).
 */

export type FieldingRules = {
  maxFielders: number;
  maxPerGender: number;
  minimumToPlay: number;
};

export const RULEBOOK: FieldingRules = {
  maxFielders: 11,
  maxPerGender: 6,
  minimumToPlay: 7,
};

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
 * What a team can field from the players who said they are in. Players whose
 * fielding group is unknown are left out, and the message says so.
 */
export function checkFielding(
  counts: { women: number; men: number; unknown?: number },
  rules: FieldingRules = RULEBOOK,
): FieldingCheck {
  const women = Math.min(counts.women, rules.maxPerGender);
  const men = Math.min(counts.men, rules.maxPerGender);
  const fielders = Math.min(women + men, rules.maxFielders);
  const unknown =
    counts.unknown && counts.unknown > 0
      ? ` ${counts.unknown} more ${counts.unknown === 1 ? "has" : "have"} not set a fielding group in their profile.`
      : "";
  const [more, fewer] = women >= men ? [women, men] : [men, women];

  if (fielders >= rules.maxFielders)
    return {
      fielders,
      level: "full",
      message: `A full ${rules.maxFielders} on defense.${unknown}`,
    };
  if (fielders < rules.minimumToPlay)
    return {
      fielders,
      level: "forfeit",
      message: `Only ${fielders} can take the field within the rule (at most ${rules.maxPerGender} of any gender). Fewer than ${rules.minimumToPlay} is a forfeit.${unknown}`,
    };
  const listed = LISTED_SHORT.find(([a, b]) => more >= a && fewer >= b);
  if (listed)
    return {
      fielders,
      level: "short",
      message: `Short-handed: you can field ${listed[0] + listed[1]} (${listed[0]} and ${listed[1]}), a lineup the rulebook allows.${unknown}`,
    };
  return {
    fielders,
    level: "check",
    message: `${fielders} can take the field (${more} and ${fewer}), which is outside the rulebook's listed lineups. Check with the ref.${unknown}`,
  };
}
