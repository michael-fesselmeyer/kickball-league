import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

describe("rule_change", () => {
  it("says what changes, when, and links the changed section", () => {
    const result = render("rule_change", {
      summary: "A new mercy rule for blowouts",
      sections: ["Scoring", "Playoffs"],
      effectiveOn: "Saturday, March 20, 2027",
      anchor: "scoring",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe(
      "Rule change from Saturday, March 20, 2027: A new mercy rule for blowouts",
    );
    expect(result.value.text).toContain(
      "It takes effect on Saturday, March 20, 2027.",
    );
    expect(result.value.text).toContain("Sections changed: Scoring, Playoffs.");
    expect(result.value.text).toContain(
      "https://league.example.test/rules#scoring",
    );
  });

  it("links another league's own rules page", () => {
    const result = render("rule_change", {
      summary: "Two-hand touch only",
      sections: ["Tackling"],
      effectiveOn: "Sunday, April 4, 2027",
      rulesPath: "/l/flag-football/rules",
      anchor: "tackling",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).toContain(
      "https://league.example.test/l/flag-football/rules#tackling",
    );
  });

  it("links the page itself when only removals changed", () => {
    const result = render("rule_change", {
      summary: "Dropped the old tiebreaker",
      sections: ["Tiebreakers"],
      effectiveOn: "Monday, April 5, 2027",
      anchor: null,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).toContain("Section changed: Tiebreakers.");
    expect(result.value.text).toContain("https://league.example.test/rules");
    expect(result.value.text).not.toContain("/rules#");
  });
});
