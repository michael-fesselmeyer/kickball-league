import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { slugify, teamSlug } from "./slug";

describe("teamSlug", () => {
  it("is the slug when the name has Latin letters or digits", () => {
    expect(teamSlug("Kick Bottom")).toBe("kick-bottom");
    expect(teamSlug("Los Pateadores ⚽")).toBe("los-pateadores");
    expect(teamSlug("Café Olé")).toBe("cafe-ole");
    expect(teamSlug("O'Malley's")).toBe("o-malley-s");
  });

  it("gives other scripts and emoji a stable code instead of nothing", () => {
    for (const name of ["الركلات", "שבעה", "キックボール", "🔥🔥🔥"]) {
      expect(slugify(name)).toBe("");
      expect(teamSlug(name)).toMatch(/^team-[0-9a-z]{1,7}$/);
      expect(teamSlug(`  ${name} `)).toBe(teamSlug(name));
    }
    expect(teamSlug("🔥🔥🔥")).not.toBe(teamSlug("🔥🔥"));
  });

  it("is empty only for a name with no letter, digit or emoji", () => {
    expect(teamSlug("")).toBe("");
    expect(teamSlug(" - . ")).toBe("");
  });

  it("is always URL-safe", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 40 }), (name) => {
        expect(teamSlug(name)).toMatch(/^([a-z0-9]+(-[a-z0-9]+)*)?$/);
      }),
    );
  });
});
