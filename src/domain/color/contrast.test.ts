import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance, type Hex } from "./contrast";

const hex = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n): Hex => `#${n.toString(16).padStart(6, "0")}`);

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#FFFFFF", "#ffffff")).toBe(1);
  });

  it("is symmetric and always between 1 and 21", () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBeCloseTo(contrastRatio(b, a), 10);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21 + 1e-9);
      }),
    );
  });

  it("rejects anything that is not #rrggbb", () => {
    expect(() => relativeLuminance("#fff")).toThrow(/#rrggbb/);
    expect(() => relativeLuminance("#gggggg")).toThrow(/#rrggbb/);
  });
});
