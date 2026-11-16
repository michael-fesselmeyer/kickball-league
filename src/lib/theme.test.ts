import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applySavedThemeScript,
  isTheme,
  readSavedTheme,
  THEME_STORAGE_KEY,
} from "./theme";

describe("isTheme", () => {
  it.each(["light", "dark"])("accepts %s", (v) =>
    expect(isTheme(v)).toBe(true),
  );
  it.each(["system", "", "blue", null, undefined, 1])("rejects %s", (v) =>
    expect(isTheme(v)).toBe(false),
  );
});

describe("readSavedTheme", () => {
  const stub = (stored: string | null, throws = false) =>
    vi.stubGlobal("localStorage", {
      getItem: () => {
        if (throws) throw new Error("blocked");
        return stored;
      },
    });
  afterEach(() => vi.unstubAllGlobals());

  it("returns a saved light or dark theme", () => {
    stub("dark");
    expect(readSavedTheme()).toBe("dark");
  });

  it("treats old, unknown or blocked storage as nothing saved", () => {
    stub("system");
    expect(readSavedTheme()).toBeNull();
    stub(null);
    expect(readSavedTheme()).toBeNull();
    stub("dark", true);
    expect(readSavedTheme()).toBeNull();
  });
});

describe("applySavedThemeScript", () => {
  const html = { dataset: {} as Record<string, string> };
  const run = (stored: string | null, throws = false) => {
    html.dataset = {};
    const storage = {
      getItem: (key: string) => {
        if (throws) throw new Error("blocked");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    };
    new Function("localStorage", "document", applySavedThemeScript)(storage, {
      documentElement: html,
    });
    return html.dataset.theme;
  };

  afterEach(() => {
    html.dataset = {};
  });

  it("applies a saved light or dark choice", () => {
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBe("light");
  });

  it("leaves the system setting in charge otherwise", () => {
    expect(run(null)).toBeUndefined();
    expect(run("system")).toBeUndefined();
    expect(run("<script>")).toBeUndefined();
  });

  it("never throws when storage is blocked", () => {
    expect(run("dark", true)).toBeUndefined();
  });
});
