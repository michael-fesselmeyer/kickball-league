import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contrastRatio, type Hex } from "../color/contrast";
import {
  badgeFill,
  DARK_INK,
  hashName,
  initials,
  inkFor,
  LIGHT_INK,
  TEAM_HUES,
} from "./badge";

const hex = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n): Hex => `#${n.toString(16).padStart(6, "0")}`);

describe("initials", () => {
  it.each([
    ["The Big Kicks", 2, "TB"],
    ["Brooklyn Kickball Club", 3, "BKC"],
    ["  ballers  ", 2, "B"],
    ["Señoritas FC", 2, "SF"],
    ["Kick-Ass Kickers", 2, "KA"],
    ["404 Not Found", 2, "4N"],
    ["!!!", 2, "?"],
    ["", 2, "?"],
  ])("%s → %s letters → %s", (name, max, expected) => {
    expect(initials(name, max)).toBe(expected);
  });

  it("uses two letters by default", () => {
    expect(initials("Red Rubber Ballers")).toBe("RR");
  });

  it("never returns more letters than asked for, and never an empty string", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 3 }), (name, max) => {
        const result = initials(name, max);
        expect([...result].length).toBeGreaterThanOrEqual(1);
        expect([...result].length).toBeLessThanOrEqual(max);
      }),
    );
  });
});

describe("badgeFill", () => {
  it("uses the team's own color when it has one", () => {
    expect(badgeFill("Any Team", "#123456")).toBe("#123456");
  });

  it("is stable: the same name always gets the same color, whatever its case or spacing", () => {
    expect(badgeFill("The Big Kicks")).toBe(badgeFill("  the big kicks "));
    fc.assert(
      fc.property(fc.string(), (name) => {
        expect(badgeFill(name)).toBe(badgeFill(name));
      }),
    );
  });

  it("only ever picks from the curated hues", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        expect(TEAM_HUES).toContain(badgeFill(name));
      }),
    );
  });

  it("spreads names across the palette", () => {
    const used = new Set(
      Array.from({ length: 200 }, (_, i) => hashName(`Team ${i}`) % 12),
    );
    expect(used.size).toBe(12);
  });
});

describe("inkFor", () => {
  it.each(TEAM_HUES.map((h) => [h]))(
    "initials on curated hue %s meet 4.5:1",
    (fill) => {
      expect(contrastRatio(inkFor(fill), fill)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("always picks the more readable ink, for any color a captain chooses", () => {
    fc.assert(
      fc.property(hex, (fill) => {
        const chosen = contrastRatio(inkFor(fill), fill);
        expect(chosen).toBeGreaterThanOrEqual(contrastRatio(DARK_INK, fill));
        expect(chosen).toBeGreaterThanOrEqual(contrastRatio(LIGHT_INK, fill));
        // Large bold initials need 3:1; the better of two inks always clears it.
        expect(chosen).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 5000 },
    );
  });
});
