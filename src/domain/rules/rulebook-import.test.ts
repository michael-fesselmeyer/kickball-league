import { describe, expect, it } from "vitest";
import { checkImportText, planImport, splitRulebook } from "./rulebook-import";
import { SAMPLE_RULEBOOK } from "./sample-rulebook";
import { BODY_MAX, planChange, TITLE_MAX } from "./rules";

describe("splitRulebook", () => {
  it("splits the sample rulebook into its numbered sections", () => {
    const { sections, warnings } = splitRulebook(SAMPLE_RULEBOOK);
    expect(sections.map((s) => s.title)).toEqual([
      "Introduction",
      "Teams and lineups",
      "Pitching",
      "Kicking and running",
      "Fielding",
      "Scoring and mercy",
      "Playoffs",
    ]);
    expect(warnings).toEqual([]);
  });

  it("keeps the text before the first heading as an introduction", () => {
    const { sections } = splitRulebook(SAMPLE_RULEBOOK);
    expect(sections[0]?.title).toBe("Introduction");
    expect(sections[0]?.body).toContain("made up for tests");
  });

  it("puts each numbered rule in its own paragraph and unwraps lines", () => {
    const { sections } = splitRulebook(
      "1. Kicking\n1.1 A kick is fair when it lands\nin front of the lines.\n1.2 Three fouls is an out.\n",
    );
    expect(sections).toEqual([
      {
        title: "Kicking",
        body: "1.1 A kick is fair when it lands in front of the lines.\n\n1.2 Three fouls is an out.",
      },
    ]);
  });

  it("makes bullets a list and does not read 'N outs' as a rule", () => {
    const { sections } = splitRulebook(
      "1. Outs\n• First\n• Second\n\nWith\n2 outs the inning ends.",
    );
    expect(sections[0]?.body).toBe(
      "- First\n- Second\n\nWith 2 outs the inning ends.",
    );
  });

  it("does not take numbered rule sentences for headings when headings are marked", () => {
    const { sections } = splitRulebook(
      "PITCHING\n1. Roll the ball\n2. Stay behind the cone\nFIELDING\n1. Tag runners",
    );
    expect(sections.map((s) => s.title)).toEqual(["Pitching", "Fielding"]);
    expect(sections[0]?.body).toBe(
      "1. Roll the ball\n\n2. Stay behind the cone",
    );
  });

  it("reads markdown and 'Section N' headings", () => {
    expect(splitRulebook("# 1. Teams\nTen play.").sections[0]?.title).toBe(
      "Teams",
    );
    expect(
      splitRulebook("Section 2: Scoring\nFive innings.").sections[0]?.title,
    ).toBe("Scoring");
  });

  it("drops page numbers and form feeds from a PDF", () => {
    const { sections } = splitRulebook(
      "1. Teams\nTen play.\n\f\n2\nThey rotate.\n",
    );
    expect(sections[0]?.body).toBe("Ten play.\n\nThey rotate.");
  });

  it("falls back to one section, with a warning, when there are no headings", () => {
    const r = splitRulebook("Just some text.");
    expect(r.sections).toEqual([
      { title: "Rulebook", body: "Just some text." },
    ]);
    expect(r.warnings).toHaveLength(1);
  });

  it("warns about an empty heading, a long title and an oversized section", () => {
    const long = "A".repeat(TITLE_MAX + 20);
    const r = splitRulebook(
      `# Empty\n# ${long}\nbody\n# Big\n${"x ".repeat(BODY_MAX)}`,
    );
    expect(r.sections.map((s) => s.title.length)).toEqual([TITLE_MAX, 3]);
    expect(r.warnings.join(" ")).toMatch(/no text/);
    expect(r.warnings.join(" ")).toMatch(/shortened/);
    expect(r.warnings.join(" ")).toMatch(/over 20,000/);
  });

  it("gives duplicate titles their own names", () => {
    const r = splitRulebook("# Teams\none\n# Teams\ntwo");
    expect(r.sections.map((s) => s.title)).toEqual(["Teams", "Teams (2)"]);
  });

  it("returns nothing for blank text", () => {
    expect(splitRulebook("  \n ").sections).toEqual([]);
  });
});

describe("checkImportText", () => {
  it("refuses blank and huge text", () => {
    expect(checkImportText(" ")).toEqual({ ok: false, error: "empty" });
    expect(checkImportText("x".repeat(300_001))).toEqual({
      ok: false,
      error: "too_big",
    });
    expect(checkImportText("ok").ok).toBe(true);
  });
});

describe("planImport", () => {
  const current = [
    { id: "a", slug: "teams", title: "Teams", body: "old", position: 0 },
    { id: "b", slug: "old", title: "Old", body: "gone", position: 1 },
  ];
  it("edits a matching title, adds a new one, removes the rest", () => {
    const plan = planImport(current, [
      { title: "teams", body: "new" },
      { title: "Pitching", body: "roll" },
    ]);
    expect(plan).toEqual([
      { id: "a", title: "teams", body: "new", remove: false },
      { id: null, title: "Pitching", body: "roll", remove: false },
      { id: "b", title: "Old", body: "gone", remove: true },
    ]);
    const planned = planChange(current, plan);
    expect(
      planned.ok && planned.value.changes.map((c) => [c.slug, c.kind]),
    ).toEqual([
      ["teams", "edited"],
      ["pitching", "added"],
      ["old", "removed"],
    ]);
  });
  it("is a plain add into an empty rulebook", () => {
    expect(planImport([], [{ title: "A", body: "b" }])).toEqual([
      { id: null, title: "A", body: "b", remove: false },
    ]);
  });
});
