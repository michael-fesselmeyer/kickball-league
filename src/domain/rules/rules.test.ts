import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  blocksOf,
  checkPublish,
  earliestWithNotice,
  planChange,
  slugify,
  SUMMARY_MAX,
  TITLE_MAX,
} from "./rules";

const LINEUPS = {
  id: "a",
  slug: "lineups",
  title: "Lineups",
  body: "Sample: ten players field at a time.",
  position: 0,
};
const PLAYOFFS = {
  id: "b",
  slug: "playoffs",
  title: "Playoffs",
  body: "Sample: the top four teams play off.",
  position: 1,
};
const CURRENT = [LINEUPS, PLAYOFFS];
const same = (s: typeof LINEUPS) => ({
  id: s.id,
  title: s.title,
  body: s.body,
  remove: false,
});

describe("slugify", () => {
  it("makes a short, safe anchor from a title", () => {
    expect(slugify("Lineups & Subs")).toBe("lineups-subs");
    expect(slugify("  Café rules!  ")).toBe("cafe-rules");
    expect(slugify("!!!")).toBe("section");
  });

  it("always matches the database's slug format", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (title) => {
        const slug = slugify(title);
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(slug.length).toBeLessThanOrEqual(60);
      }),
    );
  });
});

describe("planChange", () => {
  it("records an edit with the text before and after, keeping the slug", () => {
    const plan = planChange(CURRENT, [
      { ...same(LINEUPS), title: "Kicking order", body: "Sample: new text." },
      same(PLAYOFFS),
      { id: null, title: "", body: "", remove: false },
    ]);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.changes).toEqual([
      {
        slug: "lineups",
        kind: "edited",
        title: "Kicking order",
        titleBefore: "Lineups",
        before: LINEUPS.body,
        after: "Sample: new text.",
      },
    ]);
    expect(plan.value.sections.map((s) => s.slug)).toEqual([
      "lineups",
      "playoffs",
    ]);
  });

  it("adds a section with a slug no other section uses, and removes one", () => {
    const plan = planChange(CURRENT, [
      same(LINEUPS),
      { ...same(PLAYOFFS), remove: true },
      { id: null, title: "Lineups!", body: "Sample: more.", remove: false },
    ]);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.removeIds).toEqual(["b"]);
    expect(plan.value.sections).toEqual([
      { ...LINEUPS, position: 0 },
      {
        id: null,
        slug: "lineups-2",
        title: "Lineups!",
        body: "Sample: more.",
        position: 1,
      },
    ]);
    expect(plan.value.changes.map((c) => [c.slug, c.kind])).toEqual([
      ["lineups-2", "added"],
      ["playoffs", "removed"],
    ]);
  });

  it("refuses nothing changed, blanks, duplicates and long text", () => {
    expect(planChange(CURRENT, CURRENT.map(same))).toEqual({
      ok: false,
      error: "no_changes",
    });
    const error = (rows: Parameters<typeof planChange>[1]) =>
      planChange(CURRENT, rows);
    expect(error([{ ...same(LINEUPS), title: " " }, same(PLAYOFFS)])).toEqual({
      ok: false,
      error: "empty_title",
    });
    expect(error([{ ...same(LINEUPS), body: "" }, same(PLAYOFFS)])).toEqual({
      ok: false,
      error: "empty_body",
    });
    expect(
      error([{ ...same(LINEUPS), title: "playoffs" }, same(PLAYOFFS)]),
    ).toEqual({ ok: false, error: "duplicate_title" });
    expect(
      error([
        { ...same(LINEUPS), title: "x".repeat(TITLE_MAX + 1) },
        same(PLAYOFFS),
      ]),
    ).toEqual({ ok: false, error: "too_long" });
  });

  it("calls a form stale when a section is missing, unknown or twice", () => {
    expect(planChange(CURRENT, [same(LINEUPS)])).toEqual({
      ok: false,
      error: "stale",
    });
    expect(
      planChange(CURRENT, [
        same(LINEUPS),
        same(PLAYOFFS),
        { ...same(LINEUPS) },
      ]),
    ).toEqual({ ok: false, error: "stale" });
    expect(
      planChange(CURRENT, [
        same(LINEUPS),
        same(PLAYOFFS),
        { id: "gone", title: "Old", body: "x", remove: false },
      ]),
    ).toEqual({ ok: false, error: "stale" });
  });

  it("starts the rules from nothing", () => {
    const plan = planChange(
      [],
      [{ id: null, title: "Fielding", body: "Sample.", remove: false }],
    );
    expect(plan.ok && plan.value.changes[0]?.kind).toBe("added");
  });
});

describe("checkPublish", () => {
  const today = "2027-03-10";

  it("defaults the start to today and tidies the summary", () => {
    expect(
      checkPublish(
        { summary: "  New   mercy rule ", effectiveOn: "", notice: false },
        today,
      ),
    ).toEqual({
      ok: true,
      value: { summary: "New mercy rule", effectiveOn: today, notice: false },
    });
  });

  it("needs three days for a notice, and never a past start", () => {
    const check = (effectiveOn: string, notice: boolean) =>
      checkPublish({ summary: "Change", effectiveOn, notice }, today);
    expect(earliestWithNotice(today)).toBe("2027-03-13");
    expect(check("2027-03-12", true)).toEqual({
      ok: false,
      error: "notice_too_soon",
    });
    expect(check("2027-03-13", true).ok).toBe(true);
    expect(check("2027-03-12", false).ok).toBe(true);
    expect(check("2027-03-09", false)).toEqual({
      ok: false,
      error: "effective_in_past",
    });
    expect(check("2027-02-30", false)).toEqual({
      ok: false,
      error: "bad_date",
    });
    // Across the clocks changing, a day is still a day.
    expect(earliestWithNotice("2027-03-12")).toBe("2027-03-15");
  });

  it("refuses an empty or long summary", () => {
    for (const summary of ["  ", "x".repeat(SUMMARY_MAX + 1)])
      expect(
        checkPublish({ summary, effectiveOn: "", notice: false }, today),
      ).toEqual({ ok: false, error: "empty_summary" });
  });
});

describe("blocksOf", () => {
  it("reads paragraphs and dash lists, as plain text", () => {
    expect(
      blocksOf(
        "First line.\nSame paragraph.\r\n\r\n- one\n* two\n\n<b>not html</b>",
      ),
    ).toEqual([
      { kind: "paragraph", text: "First line.\nSame paragraph." },
      { kind: "list", items: ["one", "two"] },
      { kind: "paragraph", text: "<b>not html</b>" },
    ]);
    expect(blocksOf("  \n\n ")).toEqual([]);
  });
});
