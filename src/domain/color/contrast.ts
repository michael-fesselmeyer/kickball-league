/**
 * WCAG 2.x contrast. Used to prove the design tokens meet AA, and later to
 * pick dark or light initials on a team's chosen badge color
 * (docs/design-system.md, section 2).
 */
export type Hex = `#${string}`;

const HEX = /^#([0-9a-f]{6})$/i;

/** Relative luminance of an sRGB color, 0 (black) to 1 (white). */
export function relativeLuminance(hex: Hex): number {
  const match = HEX.exec(hex);
  if (!match?.[1]) throw new Error(`Expected a #rrggbb color, got ${hex}`);
  const value = Number.parseInt(match[1], 16);
  const channels = [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ].map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colors, from 1 (identical) to 21 (black on white). Order does not matter. */
export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG 2.2 AA minimums. */
export const AA = { text: 4.5, largeText: 3, nonText: 3 } as const;
