import { describe, expect, it } from "vitest";
import { isTranslated, localesOf, matchesPage, offeredLocales } from "./pages";

describe("matchesPage", () => {
  it("matches a page exactly, with * for one segment", () => {
    expect(matchesPage("/faq", "/faq")).toBe(true);
    expect(matchesPage("/faq", "/faq/more")).toBe(false);
    expect(matchesPage("/", "/")).toBe(true);
    expect(matchesPage("/", "/faq")).toBe(false);
    expect(
      matchesPage("/seasons/*/schedule", "/seasons/fall-2026/schedule"),
    ).toBe(true);
    expect(
      matchesPage("/seasons/*/schedule", "/seasons/fall-2026/standings"),
    ).toBe(false);
    // `*` is one segment, never a path.
    expect(matchesPage("/seasons/*/schedule", "/seasons/a/b/schedule")).toBe(
      false,
    );
  });

  it("matches the same page in another league", () => {
    expect(matchesPage("/", "/l/flag-football")).toBe(true);
    expect(
      matchesPage("/seasons/*/schedule", "/l/flag-football/seasons/x/schedule"),
    ).toBe(true);
    expect(matchesPage("/faq", "/l/Bad_Slug/faq")).toBe(false);
  });

  it("treats a pattern's dots and brackets as text", () => {
    expect(matchesPage("/teams/*/calendar.ics", "/teams/a/calendarxics")).toBe(
      false,
    );
  });
});

describe("isTranslated", () => {
  it("serves every page in English", () => {
    expect(isTranslated("en", "/anything/at/all")).toBe(true);
    expect(localesOf("/about")[0]).toBe("en");
  });
});

describe("offeredLocales", () => {
  it("offers English and each language with a translated page", () => {
    // Every language has translated pages, so the footer offers them all.
    expect(offeredLocales()).toEqual([
      "en",
      "es",
      "zh",
      "ru",
      "pl",
      "bn",
      "ko",
      "ht",
      "it",
      "fr",
    ]);
  });
});
