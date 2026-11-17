import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEAGUE_PAGE_ROOTS } from "@/domain/league/paths";
import { formatDay, formatList, formatMoney, formatNumber } from "./format";
import { type Locale, localizedPath } from "./locales";
import {
  isPagePath,
  languageAlternates,
  languageSwitchTarget,
  PROFILE_LANGUAGE,
  publicPathOf,
  SITE_PAGE_ROOTS,
  splitLocale,
  switchLanguagePath,
} from "./routing";

describe("splitLocale", () => {
  it("reads a language prefix, and only a language's own code", () => {
    expect(splitLocale("/es/faq")).toEqual({
      locale: "es",
      rest: "/faq",
      prefixed: true,
    });
    expect(splitLocale("/es")).toEqual({
      locale: "es",
      rest: "/",
      prefixed: true,
    });
    expect(splitLocale("/en/faq")).toMatchObject({
      locale: "en",
      prefixed: true,
    });
    // Two letters that aren't a language are a page, not a prefix.
    expect(splitLocale("/xx/faq")).toEqual({
      locale: "en",
      rest: "/xx/faq",
      prefixed: false,
    });
    expect(splitLocale("/espanol")).toMatchObject({ prefixed: false });
  });
});

describe("addresses in each language", () => {
  it("adds no prefix for English and the code for another language", () => {
    expect(localizedPath("en", "/faq")).toBe("/faq");
    expect(localizedPath("es", "/faq")).toBe("/es/faq");
    expect(localizedPath("es", "/")).toBe("/es");
  });

  it("finds the public address of a page, typed or as served", () => {
    expect(publicPathOf("/es/faq")).toBe("/faq");
    expect(publicPathOf("/en/l/_default/rules")).toBe("/rules");
    expect(publicPathOf("/es/l/_default")).toBe("/");
    expect(publicPathOf("/l/flag-football/rules")).toBe(
      "/l/flag-football/rules",
    );
  });

  it("switches the page you're on to another language", () => {
    expect(switchLanguagePath("/seasons/fall-2026/schedule", "es")).toBe(
      "/es/seasons/fall-2026/schedule",
    );
    expect(switchLanguagePath("/es/faq", "en")).toBe("/faq");
  });

  describe("languageSwitchTarget", () => {
    const ORIGIN = "https://league.example.test";
    const byReferer = (referer: string | null, target: Locale) =>
      languageSwitchTarget({ from: null, referer }, ORIGIN, target);
    const byFrom = (from: string | null, target: Locale, referer = null) =>
      languageSwitchTarget({ from, referer }, ORIGIN, target);

    it("goes back to the page the visitor came from, with its query", () => {
      expect(byReferer(`${ORIGIN}/es/seasons/fall-2026?team=a`, "en")).toBe(
        "/seasons/fall-2026?team=a",
      );
      expect(byReferer(`${ORIGIN}/faq`, "es")).toBe("/es/faq");
    });

    it("goes to the language's home for a page not translated", () => {
      expect(byReferer(`${ORIGIN}/records`, "es")).toBe("/es");
    });

    it("sends signed-in pages to the profile's language setting", () => {
      expect(byReferer(`${ORIGIN}/app/teams`, "es")).toBe(PROFILE_LANGUAGE);
      expect(byFrom("/app/teams", "es")).toBe(PROFILE_LANGUAGE);
    });

    it("trusts only this site's own pages as where the visitor came from", () => {
      expect(byReferer("https://elsewhere.example.test/es/faq", "en")).toBe(
        "/",
      );
      expect(byReferer("not a url", "en")).toBe("/");
      expect(byReferer(null, "en")).toBe("/");
    });

    it("prefers the link's own path to the Referer", () => {
      expect(
        languageSwitchTarget(
          { from: "/es/faq", referer: `${ORIGIN}/sw.js` },
          ORIGIN,
          "en",
        ),
      ).toBe("/faq");
      expect(byFrom("/faq", "es")).toBe("/es/faq");
      expect(byFrom("/es/seasons/fall-2026?team=a", "en")).toBe(
        "/seasons/fall-2026?team=a",
      );
    });

    it("takes only a path on this site as the link's own", () => {
      for (const from of [
        "https://elsewhere.example.test/es/faq",
        "//elsewhere.example.test/es/faq",
        "/\\elsewhere.example.test/es/faq",
        "faq",
        "javascript:alert(1)",
        "",
      ]) {
        // Falls back to the Referer, then the home page.
        expect(
          languageSwitchTarget(
            { from, referer: `${ORIGIN}/help` },
            ORIGIN,
            "es",
          ),
        ).toBe("/es/help");
        expect(byFrom(from, "en")).toBe("/");
      }
    });

    it("never sends the visitor to a file or a route that isn't a page", () => {
      for (const path of [
        "/sw.js",
        "/es/sw.js",
        "/manifest.webmanifest",
        "/_next/static/chunks/main.js",
        "/api/health",
        "/language/es",
        "/icons/icon-192.png",
      ]) {
        expect(byReferer(`${ORIGIN}${path}`, "en")).toBe("/");
        expect(byFrom(path, "en")).toBe("/");
        expect(byFrom(path, "es")).toBe("/es");
      }
    });
  });

  it("tells a page's path from a file's", () => {
    expect(isPagePath("/")).toBe(true);
    expect(isPagePath("/es/faq")).toBe(true);
    expect(isPagePath("/l/queens/seasons/fall-2026")).toBe(true);
    expect(isPagePath("/languages")).toBe(true);
    expect(isPagePath("/sw.js")).toBe(false);
    expect(isPagePath("/_next")).toBe(false);
    expect(isPagePath("/api/me")).toBe(false);
    expect(isPagePath("/language/en")).toBe(false);
  });

  it("lists alternates only for a page in more than one language", () => {
    expect(languageAlternates("/faq")).toEqual({
      en: "/faq",
      es: "/es/faq",
      "zh-Hans": "/zh/faq",
      ru: "/ru/faq",
      pl: "/pl/faq",
      bn: "/bn/faq",
      ko: "/ko/faq",
      ht: "/ht/faq",
      it: "/it/faq",
      fr: "/fr/faq",
      "x-default": "/faq",
    });
    // The help center is in Spanish only so far.
    expect(languageAlternates("/help/player")).toEqual({
      en: "/help/player",
      es: "/es/help/player",
      "x-default": "/help/player",
    });
    expect(languageAlternates("/records")).toEqual({});
  });
});

describe("the language tree", () => {
  it("names every top-level page folder as a site or league root", () => {
    const tree = join(process.cwd(), "src/app/[lang]");
    const folders = readdirSync(tree).filter(
      (name) =>
        statSync(join(tree, name)).isDirectory() && !name.startsWith("["),
    );
    const known = new Set<string>([...SITE_PAGE_ROOTS, "l"]);
    expect(folders.filter((f) => !known.has(f))).toEqual([]);
    expect(SITE_PAGE_ROOTS.filter((r) => !folders.includes(r))).toEqual([]);
    // A league root can't also be a site page.
    expect(
      LEAGUE_PAGE_ROOTS.filter((r) =>
        (SITE_PAGE_ROOTS as readonly string[]).includes(r),
      ),
    ).toEqual([]);
  });
});

describe("formatting by language", () => {
  it("writes days, numbers, money and lists the language's way", () => {
    expect(formatDay("en", "2027-03-20")).toBe("Saturday, March 20");
    expect(formatDay("es", "2027-03-20")).toBe("sábado, 20 de marzo");
    expect(formatNumber("en", 1250)).toBe("1,250");
    expect(formatMoney("en", 8500)).toBe("$85.00");
    expect(formatMoney("en", 8500, { whole: true })).toBe("$85");
    // US Spanish writes dollars as "$85.50" (es-US), like the money players pay.
    expect(formatMoney("es", 8550)).toMatch(/85[.,]50/);
    expect(formatList("en", ["A", "B", "C"])).toBe("A, B, and C");
    expect(formatList("es", ["A", "B", "C"])).toBe("A, B y C");
  });
});
