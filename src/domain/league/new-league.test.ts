import { describe, expect, it } from "vitest";
import { parseNewLeague, sportLabel } from "./new-league";

const valid = {
  name: "Sunday Flag Football",
  slug: "Flag-Football",
  sport: "football",
  timeZone: "America/Chicago",
  minimumAge: "21",
  primaryColor: "#14532d",
  secondaryColor: "#F5B301",
  ruleSetName: "Standard",
  innings: "",
  timeLimitMinutes: "50",
};

describe("parseNewLeague", () => {
  it("accepts a complete league and normalizes it", () => {
    const parsed = parseNewLeague(valid);
    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "Sunday Flag Football",
        slug: "flag-football",
        sport: "football",
        timeZone: "America/Chicago",
        minimumAge: 21,
        primaryColor: "#14532D",
        secondaryColor: "#F5B301",
        ruleSet: { name: "Standard", innings: null, timeLimitMinutes: 50 },
      },
    });
  });

  it("names each field that is wrong", () => {
    const parsed = parseNewLeague({
      ...valid,
      slug: "flag football",
      timeZone: "Mars/Olympus",
      minimumAge: "16",
      primaryColor: "green",
      innings: "40",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual([
      "innings",
      "minimumAge",
      "primaryColor",
      "slug",
      "timeZone",
    ]);
  });

  it("keeps addresses the site itself uses", () => {
    for (const slug of ["app", "api", "l", "_default"]) {
      const parsed = parseNewLeague({ ...valid, slug });
      expect(parsed.ok, slug).toBe(false);
    }
  });

  it("labels known sports and falls back to Other", () => {
    expect(sportLabel("football")).toBe("Flag football");
    expect(sportLabel("curling")).toBe("Other");
  });
});
