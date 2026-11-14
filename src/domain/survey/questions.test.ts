import { describe, expect, it } from "vitest";
import {
  type AnswerForm,
  mayAnswer,
  mayOpen,
  parseAnswerForm,
  summarize,
  turnoutLine,
} from "./questions";

const form = (over: Partial<AnswerForm> = {}): AnswerForm => ({
  rating: "4",
  wouldReturn: "yes",
  bestPart: "  The bar after  ",
  oneChange: "",
  comment: " ",
  ...over,
});

describe("parseAnswerForm", () => {
  it("trims the written answers and leaves blank ones out", () => {
    expect(parseAnswerForm(form())).toEqual({
      ok: true,
      value: {
        rating: 4,
        wouldReturn: "yes",
        bestPart: "The bar after",
        oneChange: null,
        comment: null,
      },
    });
  });

  it.each([
    [{ rating: "" }, "rating"],
    [{ rating: "0" }, "rating"],
    [{ rating: "6" }, "rating"],
    [{ rating: "4.5" }, "rating"],
    [{ wouldReturn: "" }, "would_return"],
    [{ wouldReturn: "probably" }, "would_return"],
    [{ bestPart: "x".repeat(501) }, "too_long"],
    [{ oneChange: "x".repeat(501) }, "too_long"],
    [{ comment: "x".repeat(1001) }, "too_long"],
  ] as const)("refuses %o with %s", (over, error) => {
    expect(parseAnswerForm(form(over))).toEqual({ ok: false, error });
  });

  it("takes the longest answers allowed", () => {
    expect(
      parseAnswerForm(
        form({ bestPart: "x".repeat(500), comment: "y".repeat(1000) }),
      ).ok,
    ).toBe(true);
  });
});

describe("mayOpen", () => {
  it("opens only for a completed season", () => {
    expect(mayOpen("completed").ok).toBe(true);
    for (const status of ["in_progress", "playoffs", "draft"])
      expect(mayOpen(status)).toEqual({ ok: false, error: "not_completed" });
  });
});

describe("mayAnswer", () => {
  const open = { openedAt: new Date("2026-11-01T00:00:00Z"), closedAt: null };

  it("lets a rostered player answer once while open", () => {
    expect(
      mayAnswer({ survey: open, rostered: true, answered: false }).ok,
    ).toBe(true);
    expect(mayAnswer({ survey: open, rostered: true, answered: true })).toEqual(
      { ok: false, error: "already" },
    );
  });

  it("refuses players who weren't on a roster, and a closed survey", () => {
    expect(
      mayAnswer({ survey: open, rostered: false, answered: false }),
    ).toEqual({ ok: false, error: "not_rostered" });
    expect(
      mayAnswer({
        survey: { ...open, closedAt: new Date("2026-11-08T00:00:00Z") },
        rostered: true,
        answered: false,
      }),
    ).toEqual({ ok: false, error: "closed" });
  });
});

describe("summarize", () => {
  it("counts ratings and returns, and averages to one decimal", () => {
    const results = summarize([
      {
        rating: 5,
        wouldReturn: "yes",
        bestPart: null,
        oneChange: null,
        comment: null,
      },
      {
        rating: 4,
        wouldReturn: "yes",
        bestPart: null,
        oneChange: null,
        comment: null,
      },
      {
        rating: 4,
        wouldReturn: "maybe",
        bestPart: null,
        oneChange: null,
        comment: null,
      },
    ]);
    expect(results.answers).toBe(3);
    expect(results.ratingCounts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
    expect(results.averageRating).toBe(4.3);
    expect(results.returnCounts).toEqual({ yes: 2, maybe: 1, no: 0 });
  });

  it("has no average with no answers", () => {
    expect(summarize([]).averageRating).toBeNull();
  });

  it("lists each question's written answers on its own, sorted, so order says nothing", () => {
    const results = summarize([
      {
        rating: 2,
        wouldReturn: "no",
        bestPart: "Zany jerseys",
        oneChange: "Earlier games",
        comment: null,
      },
      {
        rating: 5,
        wouldReturn: "yes",
        bestPart: "After-party",
        oneChange: null,
        comment: "More bars",
      },
    ]);
    expect(results.bestParts).toEqual(["After-party", "Zany jerseys"]);
    expect(results.oneChanges).toEqual(["Earlier games"]);
    expect(results.comments).toEqual(["More bars"]);
    // The lists carry text only: no rating or position ties them together.
    expect(Object.keys(results).sort()).toEqual([
      "answers",
      "averageRating",
      "bestParts",
      "comments",
      "oneChanges",
      "ratingCounts",
      "returnCounts",
    ]);
  });
});

describe("turnoutLine", () => {
  it("says how many answered", () => {
    expect(turnoutLine(12, 30)).toBe("12 of 30 players answered (40%)");
    expect(turnoutLine(1, 1)).toBe("1 of 1 player answered (100%)");
    expect(turnoutLine(0, 0)).toBe("No players were on a roster that season.");
  });
});
