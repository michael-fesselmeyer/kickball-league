import type { MetadataRoute } from "next";
import { APP_ICONS, type AppIconName, appIconPath } from "@/lib/pwa/icons";
import { THEME_COLORS } from "@/lib/pwa/theme-colors";
import { SITE } from "@/lib/site";

const MANIFEST_ICONS: readonly AppIconName[] = [
  "icon-192.png",
  "icon-512.png",
  "maskable-512.png",
];

/**
 * The web app manifest that makes the site installable (docs/architecture.md,
 * section 14). The installed app opens on the signed-in home screen, where
 * captains, refs and admins start game day. A manifest holds one theme
 * color; the dark one is set per color scheme in the root layout's viewport.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE.name,
    short_name: "Kickball",
    description: SITE.description,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLORS.light.background,
    theme_color: THEME_COLORS.light.theme,
    categories: ["sports", "social"],
    icons: MANIFEST_ICONS.map((name) => {
      const { size, maskable } = APP_ICONS[name];
      return {
        src: appIconPath(name),
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: maskable ? "maskable" : "any",
      };
    }),
  };
}
