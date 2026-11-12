/** The theme choice stored per device. "system" means: follow the OS setting. */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

export const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === "system" || value === "light" || value === "dark";

/**
 * Runs in <head> before first paint, so a saved theme never flashes the other
 * one. Kept tiny and dependency-free because it is inlined into every page.
 */
export const applySavedThemeScript = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
