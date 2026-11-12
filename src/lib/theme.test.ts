import { afterEach, describe, expect, it } from "vitest";
import {
  applySavedThemeScript,
  isThemeChoice,
  THEME_STORAGE_KEY,
} from "./theme";

describe("isThemeChoice", () => {
  it.each(["system", "light", "dark"])("accepts %s", (v) =>
    expect(isThemeChoice(v)).toBe(true),
  );
  it.each(["", "blue", null, undefined, 1])("rejects %s", (v) =>
    expect(isThemeChoice(v)).toBe(false),
  );
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
