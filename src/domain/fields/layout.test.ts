import { describe, expect, it } from "vitest";
import { layoutState, MAX_LAYOUT_NOTE, parseLayoutNote } from "./layout";

describe("layoutState", () => {
  it("is missing with no row, or a row with neither a file nor an answer", () => {
    expect(layoutState(null)).toBe("missing");
    expect(layoutState({ fileId: null, noLayoutNeeded: false })).toBe(
      "missing",
    );
  });

  it("is a layout with a file, and none needed on an admin's word", () => {
    expect(layoutState({ fileId: "f", noLayoutNeeded: false })).toBe("layout");
    expect(layoutState({ fileId: null, noLayoutNeeded: true })).toBe(
      "none_needed",
    );
  });
});

describe("parseLayoutNote", () => {
  it("trims, collapses spaces and treats empty as no note", () => {
    expect(parseLayoutNote("  cones   at the\n four corners ")).toBe(
      "cones at the four corners",
    );
    expect(parseLayoutNote("   ")).toBeNull();
  });

  it("refuses a note over the limit", () => {
    expect(parseLayoutNote("a".repeat(MAX_LAYOUT_NOTE))).toHaveLength(
      MAX_LAYOUT_NOTE,
    );
    expect(parseLayoutNote("a".repeat(MAX_LAYOUT_NOTE + 1))).toBe("too_long");
  });
});
