import { describe, expect, it } from "vitest";
import {
  canReadRulebook,
  numberedBlocksOf,
  rulesMatching,
  searchTerms,
  tsQueryOf,
} from "./rulebook";

describe("canReadRulebook", () => {
  it("shows owners only to owners", () => {
    expect(canReadRulebook("owners", "owner")).toBe(true);
    // The admin rules editor shows the text, so it uses this check too.
    expect(canReadRulebook("owners", "admin")).toBe(false);
    expect(canReadRulebook("owners", "player")).toBe(false);
    expect(canReadRulebook("owners", null)).toBe(false);
  });
  it("shows members only to anyone with an account", () => {
    expect(canReadRulebook("members", "player")).toBe(true);
    expect(canReadRulebook("members", "admin")).toBe(true);
    expect(canReadRulebook("members", null)).toBe(false);
  });
  it("shows public to everyone", () => {
    expect(canReadRulebook("public", null)).toBe(true);
  });
});

describe("numberedBlocksOf", () => {
  const body =
    "1.1 First rule.\n\n1.2. Second rule.\n\nA plain note.\n\n- one\n- two\n\n2 outs is not a rule.";
  it("numbers rules and gives each an anchor", () => {
    const blocks = numberedBlocksOf("lineups", body);
    expect(blocks[0]).toEqual({
      kind: "rule",
      number: "1.1",
      anchor: "rule-lineups--1-1",
      text: "First rule.",
    });
    expect(blocks[1]).toMatchObject({ kind: "rule", number: "1.2" });
    expect(blocks[2]).toEqual({ kind: "paragraph", text: "A plain note." });
    expect(blocks[3]).toEqual({ kind: "list", items: ["one", "two"] });
    expect(blocks[4]?.kind).toBe("paragraph");
  });
  it("keeps anchors unique when a number repeats", () => {
    const anchors = numberedBlocksOf("a", "1. x\n\n1. y")
      .map((b) => (b.kind === "rule" ? b.anchor : ""))
      .filter(Boolean);
    expect(new Set(anchors).size).toBe(2);
  });
});

describe("search terms", () => {
  it("keeps letters and digits only, so nothing changes the query", () => {
    expect(searchTerms("  Bunting & 'stealing'; drop table!  ")).toEqual([
      "bunting",
      "stealing",
      "drop",
      "table",
    ]);
    expect(tsQueryOf(searchTerms("a | b:* ()"))).toBe("a:* & b:*");
  });
  it("drops accents, repeats and anything past eight words", () => {
    expect(searchTerms("café Café")).toEqual(["cafe"]);
    expect(searchTerms("1 2 3 4 5 6 7 8 9 10")).toHaveLength(8);
  });
  it("is empty for nothing searchable", () => {
    expect(searchTerms("!!! ??")).toEqual([]);
    expect(tsQueryOf([])).toBeNull();
  });
});

describe("rulesMatching", () => {
  const body =
    "3.1 A kick is fair in front of the lines.\n\n3.2 Three fouls is an out.\n\n3.3 Runners kick nothing; fouls and kicks both count.";
  it("finds the rules with the words, best match first", () => {
    const hits = rulesMatching("kicking", body, ["fouls", "kicks"]);
    expect(hits[0]?.number).toBe("3.3");
    expect(hits.map((h) => h.number)).toContain("3.2");
  });
  it("matches an ending-different word", () => {
    expect(rulesMatching("k", body, ["kicking"])[0]?.number).toBe("3.1");
  });
  it("returns nothing when no rule has the words", () => {
    expect(rulesMatching("k", body, ["pitcher"])).toEqual([]);
  });
});
