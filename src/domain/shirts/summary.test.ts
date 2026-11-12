import { describe, expect, it } from "vitest";
import { countShirts, isShirtStatus, sizeLabel } from "./summary";

describe("countShirts", () => {
  it("counts sizes, statuses and what is still to order", () => {
    const counts = countShirts([
      { size: "m", status: "received" },
      { size: "m", status: "ordered" },
      { size: "l", status: "none" },
      { size: "xs", status: "none" },
      { size: null, status: "none" },
      { size: null, status: "received" },
    ]);
    expect(counts).toEqual({
      bySize: { xs: 1, s: 0, m: 2, l: 1, xl: 0, xxl: 0 },
      unknown: 2,
      total: 6,
      ordered: 1,
      received: 2,
      toOrder: { xs: 1, s: 0, m: 0, l: 1, xl: 0, xxl: 0 },
      toOrderUnknown: 1,
    });
  });

  it("counts nothing for an empty team", () => {
    const counts = countShirts([]);
    expect(counts.total).toBe(0);
    expect(Object.values(counts.bySize).every((n) => n === 0)).toBe(true);
  });
});

describe("labels and parsing", () => {
  it("labels sizes", () => {
    expect(sizeLabel("xxl")).toBe("XXL");
    expect(sizeLabel(null)).toBe("No size");
  });

  it("accepts only known statuses", () => {
    expect(isShirtStatus("received")).toBe(true);
    expect(isShirtStatus("lost")).toBe(false);
    expect(isShirtStatus(null)).toBe(false);
  });
});
