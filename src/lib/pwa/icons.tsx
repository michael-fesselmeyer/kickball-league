import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { initials } from "@/domain/badge/badge";
import { SITE } from "@/lib/site";

/**
 * Home-screen icons (docs/design-system.md, section 7, "App icon"). Until the
 * league publishes its logo, they draw the league placeholder that
 * LogoBadge draws: a brand-blue pennant with the league's initials. The image
 * engine has no CSS variables, so the light theme's token values are
 * repeated here.
 */

const T = {
  bg: "#FBF8F1",
  brand: "#1F3A8A",
  onBrand: "#FFFFFF",
  accent: "#8F1A1C",
} as const;

export type AppIcon = {
  size: number;
  /**
   * Maskable icons keep the art inside the central 80%, because Android
   * crops them to a circle or squircle. iPhone rounds the corners of its
   * home-screen icon, so it gets the same padding.
   */
  maskable: boolean;
};

export const APP_ICONS = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true },
} as const satisfies Record<string, AppIcon>;

export type AppIconName = keyof typeof APP_ICONS;

export const isAppIconName = (name: string): name is AppIconName =>
  Object.hasOwn(APP_ICONS, name);

export const appIconPath = (name: AppIconName) => `/icons/${name}`;

/**
 * How much of the icon the pennant's 100-unit box spans. At 0.6 every corner
 * of the pennant and its pole stays inside the maskable safe circle.
 */
export const artScale = (icon: AppIcon) => (icon.maskable ? 0.6 : 0.84);

let display: Promise<Buffer> | undefined;

export async function renderAppIcon(icon: AppIcon): Promise<ImageResponse> {
  display ??= readFile(
    join(
      process.cwd(),
      "assets/fonts/bricolage-grotesque-latin-800-normal.woff",
    ),
  );
  const { size } = icon;
  const art = Math.round(size * artScale(icon));
  const offset = Math.round((size - art) / 2);
  const unit = art / 100;
  const letters = initials(SITE.name, 3);
  const fontSize = (letters.length > 2 ? 22 : 28) * unit;
  return new ImageResponse(
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        position: "relative",
        background: T.bg,
      }}
    >
      <svg
        width={art}
        height={art}
        viewBox="0 0 100 100"
        style={{ position: "absolute", left: offset, top: offset }}
      >
        <path d="M8 12 L92 50 L8 88 Z" fill={T.brand} strokeLinejoin="round" />
        <rect x="4" y="8" width="7" height="88" rx="3" fill={T.accent} />
      </svg>
      <div
        style={{
          position: "absolute",
          // The badge centers its initials at (42, 50) in the pennant's box.
          left: offset,
          width: 84 * unit,
          top: offset,
          height: 100 * unit,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Display",
          fontSize,
          color: T.onBrand,
        }}
      >
        {letters}
      </div>
    </div>,
    {
      width: size,
      height: size,
      fonts: [
        { name: "Display", data: await display, weight: 800, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=86400" },
    },
  );
}
