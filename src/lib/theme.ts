/** The theme a visitor picked, stored per device. With nothing stored, the OS setting decides. */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

export const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark";

/**
 * The stored theme, or null when none is saved. Values from earlier versions
 * (such as "system") and anything unexpected count as nothing saved.
 */
export function readSavedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Runs in <head> before first paint, so a saved theme never flashes the other
 * one. Kept tiny and dependency-free because it is inlined into every page.
 */
export const applySavedThemeScript = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
