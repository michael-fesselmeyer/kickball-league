import { dark, light } from "@/design/tokens";
import type { MarkColors } from "@/lib/pwa/icons";

/**
 * The source images the native apps' icons and splash screens are cut from
 * (docs/mobile.md). `npm run mobile:assets` draws them into mobile/assets/
 * with the league placeholder mark, and the Capacitor assets tool turns them
 * into every size each platform asks for. The league's own logo stays out
 * of the repository until the league publishes it; when it does, only the
 * mark changes.
 */

export type MobileAsset = {
  /** The file name the assets tool looks for. */
  file: string;
  /** Width and height in pixels; every source is square. */
  size: number;
  /** How much of the square the pennant's box spans. */
  fraction: number;
  colors: MarkColors;
};

const lightMark: MarkColors = {
  background: light.bg,
  brand: light.brand,
  onBrand: light["on-brand"],
  accent: light.accent,
};

const darkMark: MarkColors = {
  background: dark.bg,
  brand: dark.brand,
  onBrand: dark["on-brand"],
  accent: dark.accent,
};

/**
 * Android crops an adaptive icon's foreground to a circle 66/108 of its
 * width at the smallest. The pennant's farthest corner sits 0.667 of its box
 * from the center (the same geometry that keeps the web app's maskable
 * icon at 0.6 inside 80%), so 0.45 keeps it inside that circle.
 */
export const ADAPTIVE_FRACTION = 0.45;

export const MOBILE_ASSETS: readonly MobileAsset[] = [
  // iOS rounds the icon's corners itself, so it gets the maskable padding.
  { file: "icon-only.png", size: 1024, fraction: 0.6, colors: lightMark },
  {
    file: "icon-foreground.png",
    size: 1024,
    fraction: ADAPTIVE_FRACTION,
    colors: { ...lightMark, background: null },
  },
  {
    file: "icon-background.png",
    size: 1024,
    // A plain square: the pennant is drawn at zero size.
    fraction: 0,
    colors: lightMark,
  },
  // Splash screens are cropped to the screen's shape around the center, so
  // the mark stays small and centered.
  { file: "splash.png", size: 2732, fraction: 0.2, colors: lightMark },
  { file: "splash-dark.png", size: 2732, fraction: 0.2, colors: darkMark },
];
