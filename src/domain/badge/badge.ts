import { contrastRatio, type Hex } from "../color/contrast";

/**
 * Placeholder logic for logo badges (docs/design-system.md, section 7):
 * initials from a name, a stable color when a team has none, and the ink
 * (dark or light) that reads best on any fill.
 */

/** A letter or digit that starts a word (nothing alphanumeric right before it). */
const WORD_START = /(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu;

/** First letters of up to `max` words, uppercased. "The Big Kicks" → "TB". */
export function initials(name: string, max = 2): string {
  const letters = Array.from(
    name.matchAll(WORD_START),
    (match) => match[0],
  ).slice(0, max);
  return letters.join("").toLocaleUpperCase() || "?";
}

/** FNV-1a: a tiny, stable string hash, so a name always maps to the same color. */
export function hashName(name: string): number {
  let hash = 0x811c9dc5;
  const text = name.trim().toLowerCase();
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Twelve curated, saturated, fun team colors. Each reads with dark or light initials (tested). */
export const TEAM_HUES = [
  "#DB3643", // tomato
  "#F4A261", // sunset
  "#E9C46A", // mustard
  "#2A9D8F", // lagoon
  "#264653", // deep teal
  "#6A4C93", // grape
  "#187CBA", // pool
  "#8AC926", // lime
  "#FF595E", // watermelon
  "#3D405B", // slate
  "#F15BB5", // bubblegum
  "#00B4D8", // sky
] as const satisfies readonly Hex[];

/** A team's color, or a stable pick from TEAM_HUES when it has none. */
export function badgeFill(name: string, color?: Hex | null): Hex {
  // The modulo keeps the index in range, so the lookup always hits.
  return color ?? (TEAM_HUES[hashName(name) % TEAM_HUES.length] as Hex);
}

export const DARK_INK: Hex = "#14182B";
export const LIGHT_INK: Hex = "#FFFFFF";

/** Dark or light initials, whichever contrasts more with the fill. */
export function inkFor(fill: Hex): Hex {
  return contrastRatio(DARK_INK, fill) >= contrastRatio(LIGHT_INK, fill)
    ? DARK_INK
    : LIGHT_INK;
}
