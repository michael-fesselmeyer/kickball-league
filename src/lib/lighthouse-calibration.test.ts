import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANCHOR_BENCHMARK_INDEX,
  ANCHOR_SLOWDOWN,
  MAX_SLOWDOWN,
  MIN_SLOWDOWN,
  medianOf,
  slowdownFor,
  withSlowdown,
} from "../../scripts/lighthouse-calibration.mjs";

type Config = {
  ci: {
    collect: { settings: { throttling: { cpuSlowdownMultiplier: number } } };
  };
};
const rc = JSON.parse(readFileSync("lighthouserc.json", "utf8")) as Config;

describe("slowdownFor", () => {
  it("keeps the budgets' phone: the anchor runner gets today's 4x", () => {
    expect(slowdownFor(ANCHOR_BENCHMARK_INDEX)).toBe(ANCHOR_SLOWDOWN);
    expect(rc.ci.collect.settings.throttling.cpuSlowdownMultiplier).toBe(
      ANCHOR_SLOWDOWN,
    );
  });

  it("slows a faster runner more and a slower runner less, in proportion", () => {
    expect(slowdownFor(2400)).toBe(2.78);
    expect(slowdownFor(2950)).toBe(3.42);
    expect(slowdownFor(4200)).toBe(4.87);
    expect(slowdownFor(2400)).toBeLessThan(slowdownFor(3450));
    expect(slowdownFor(4200)).toBeGreaterThan(slowdownFor(3450));
  });

  it("stays inside the sanity limits", () => {
    expect(slowdownFor(100)).toBe(MIN_SLOWDOWN);
    expect(slowdownFor(100_000)).toBe(MAX_SLOWDOWN);
  });

  it("refuses a number that isn't an index", () => {
    expect(() => slowdownFor(Number.NaN)).toThrow();
    expect(() => slowdownFor(0)).toThrow();
    expect(() => slowdownFor(-5)).toThrow();
  });
});

describe("medianOf", () => {
  it("takes the middle sample, so one odd sample doesn't move it", () => {
    expect(medianOf([3400, 900, 3500, 3450, 3300])).toBe(3400);
  });
  it("averages the middle two of an even count", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
  it("needs at least one sample", () => {
    expect(() => medianOf([])).toThrow();
  });
});

describe("withSlowdown", () => {
  it("changes the CPU slowdown and nothing else, budgets included", () => {
    const calibrated = withSlowdown(rc, 2.78);
    expect(
      calibrated.ci.collect.settings.throttling.cpuSlowdownMultiplier,
    ).toBe(2.78);
    // Put the original multiplier back and the whole config is identical.
    const restored = withSlowdown(calibrated, ANCHOR_SLOWDOWN);
    expect(restored).toEqual(rc);
  });

  it("does not alter the config it was given", () => {
    withSlowdown(rc, 2);
    expect(rc.ci.collect.settings.throttling.cpuSlowdownMultiplier).toBe(4);
  });
});
