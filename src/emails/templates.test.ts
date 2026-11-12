import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

const announcement = {
  subject: "Field change Saturday",
  body: "We moved to Field 3.\n\nBring water.",
  from: "League admins",
  seasonName: "Fall 2026",
  seasonSlug: "fall-2026",
};

describe("rendererFor", () => {
  it("renders a league-wide announcement", () => {
    const result = render("announcement", announcement);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Field change Saturday");
    expect(result.value.text).toContain("We moved to Field 3.\n\nBring water.");
    expect(result.value.text).toContain("— League admins");
    expect(result.value.text).toContain(
      "because you are registered for Fall 2026",
    );
    expect(result.value.text).toContain(
      "https://league.example.test/app/seasons/fall-2026",
    );
  });

  it("says which team a team announcement went to", () => {
    const result = render("announcement", {
      ...announcement,
      from: "Sam, captain of Kick Assets",
      teamName: "Kick Assets",
    });
    expect(result.ok && result.value.text).toContain(
      "because you play on Kick Assets in Fall 2026",
    );
  });

  it("refuses a payload that does not match its template", () => {
    expect(render("announcement", { subject: "Hi" })).toEqual({
      ok: false,
      error: "The message payload does not match its template",
    });
  });

  it("refuses an unknown template", () => {
    expect(render("nope", {})).toEqual({
      ok: false,
      error: "No email template named nope",
    });
  });
});
