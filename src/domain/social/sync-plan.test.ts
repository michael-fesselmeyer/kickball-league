import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { altFor, isShown, planSync } from "./sync-plan";

const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const post = (id: string, day: number) => ({
  externalId: id,
  takenAt: at(day),
});

describe("planSync", () => {
  it("adds new posts and updates the ones it has", () => {
    const plan = planSync([post("a", 1)], [post("b", 2), post("a", 1)], true);
    expect(plan.add.map((p) => p.externalId)).toEqual(["b"]);
    expect(plan.update.map((p) => p.externalId)).toEqual(["a"]);
    expect(plan.remove).toEqual([]);
  });

  it("removes a missing post only when it is within the page read", () => {
    const stored = [post("old", 1), post("gone", 5), post("kept", 6)];
    const fetched = [post("kept", 6), post("new", 7), post("edge", 4)];
    expect(planSync(stored, fetched, false).remove).toEqual(["gone"]);
  });

  it("removes every missing post when the page was the whole account", () => {
    const stored = [post("old", 1), post("gone", 5)];
    expect(planSync(stored, [post("x", 9)], true).remove).toEqual([
      "old",
      "gone",
    ]);
  });

  it("removes everything when a complete read finds no posts, and nothing when an incomplete one does", () => {
    const stored = [post("a", 1)];
    expect(planSync(stored, [], true).remove).toEqual(["a"]);
    expect(planSync(stored, [], false).remove).toEqual([]);
  });

  it("never removes a post it just read, and never adds one it has", () => {
    const posts = fc.array(
      fc.record({
        externalId: fc.constantFrom<string>("a", "b", "c", "d", "e"),
        takenAt: fc.integer({ min: 1, max: 28 }).map(at),
      }),
    );
    fc.assert(
      fc.property(posts, posts, fc.boolean(), (stored, fetched, complete) => {
        const plan = planSync(stored, fetched, complete);
        const read = new Set(fetched.map((f) => f.externalId));
        const have = new Set(stored.map((s) => s.externalId));
        expect(plan.remove.some((id) => read.has(id))).toBe(false);
        expect(plan.add.some((p) => have.has(p.externalId))).toBe(false);
        expect(plan.add.length + plan.update.length).toBe(fetched.length);
      }),
    );
  });
});

describe("isShown", () => {
  it("shows featured posts, or every post when showing the newest, but never hidden ones", () => {
    expect(isShown({ hidden: false, featured: true }, false)).toBe(true);
    expect(isShown({ hidden: false, featured: false }, false)).toBe(false);
    expect(isShown({ hidden: false, featured: false }, true)).toBe(true);
    expect(isShown({ hidden: true, featured: false }, true)).toBe(false);
  });
});

describe("altFor", () => {
  it("prefers the admin's words, then the caption's first line", () => {
    expect(altFor({ altText: " Team photo ", caption: "x" })).toBe(
      "Team photo",
    );
    expect(altFor({ altText: null, caption: "Opening day!\n#kickball" })).toBe(
      "Opening day!",
    );
    expect(altFor({ altText: "", caption: null })).toBe(
      "A photo from the league's Instagram",
    );
    expect(altFor({ altText: null, caption: "x".repeat(200) })).toHaveLength(
      120,
    );
  });
});
