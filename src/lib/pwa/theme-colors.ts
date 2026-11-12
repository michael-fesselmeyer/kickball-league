import { dark, light } from "@/design/tokens";

/**
 * Browser and installed-app chrome colors in both themes. The status bar
 * takes the header's surface color so it reads as part of the header; the
 * splash screen takes the page background.
 */
export const THEME_COLORS = {
  light: { theme: light.surface, background: light.bg },
  dark: { theme: dark.surface, background: dark.bg },
} as const;
