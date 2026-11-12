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

  it("renders a payment reminder for the days left", () => {
    const remind = (daysLeft: number, needsWaiver = false) => {
      const result = render("payment_reminder", {
        seasonName: "Fall 2026",
        seasonSlug: "fall-2026",
        deadline: "Friday, September 11 at 11:59 PM",
        daysLeft,
        needsWaiver,
      });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    expect(remind(7).subject).toBe("Your Fall 2026 fee is due in 7 days");
    expect(remind(1).subject).toBe("Your Fall 2026 fee is due tomorrow");
    expect(remind(0).subject).toBe("Your Fall 2026 fee is due today");
    expect(remind(3).text).toContain(
      "Pay now: https://league.example.test/app/seasons/fall-2026",
    );
    expect(remind(3, true).text).toContain("Sign the season waiver first");
  });

  it("refuses an unknown template", () => {
    expect(render("nope", {})).toEqual({
      ok: false,
      error: "No email template named nope",
    });
  });
});
