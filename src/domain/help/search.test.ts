import { describe, expect, it } from "vitest";
import { normalize, searchHelp } from "./search";

const entry = (title: string, summary: string, keywords: string[] = []) => ({
  href: `/help/x#${title}`,
  title,
  summary,
  role: "Players",
  keywords,
});

const ENTRIES = [
  entry("Pay your share", "Pay by card with a promo code.", ["money"]),
  entry("Call a rain-out", "Cancel a game day and review makeups.", [
    "weather",
  ]),
  entry("Report an incident", "Tell the league about a safety problem."),
  entry("Keep the books", "Record expenses; you can pay for receipts later."),
];

describe("normalize", () => {
  it("lowercases and drops accents and punctuation", () => {
    expect(normalize("  Rain-Out, Café!  ")).toBe("rain out cafe");
  });
});

describe("searchHelp", () => {
  it("finds nothing for an empty query", () => {
    expect(searchHelp(ENTRIES, "   ")).toEqual([]);
  });

  it("matches the start of words, so a short query finds longer ones", () => {
    expect(searchHelp(ENTRIES, "rain").map((e) => e.title)).toEqual([
      "Call a rain-out",
    ]);
    expect(searchHelp(ENTRIES, "weath").map((e) => e.title)).toEqual([
      "Call a rain-out",
    ]);
    // "out" is a word of "rain-out", but "ut" starts none.
    expect(searchHelp(ENTRIES, "ut")).toEqual([]);
  });

  it("needs every word, and ranks title matches first", () => {
    expect(searchHelp(ENTRIES, "pay").map((e) => e.title)).toEqual([
      "Pay your share",
      "Keep the books",
    ]);
    expect(searchHelp(ENTRIES, "pay receipts").map((e) => e.title)).toEqual([
      "Keep the books",
    ]);
  });

  it("reads hyphens and capitals the way people type them", () => {
    expect(searchHelp(ENTRIES, "Rain Out")).toHaveLength(1);
    expect(searchHelp(ENTRIES, "rain-out")).toHaveLength(1);
  });
});
