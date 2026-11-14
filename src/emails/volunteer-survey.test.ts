import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

describe("the volunteer reminder", () => {
  it("says what, when and where, and links to the shifts", () => {
    const result = render("volunteer_reminder", {
      role: "Check-in table",
      occasion: "Fall Social game day",
      when: "Tue, Oct 20, 6:00 – 6:45 PM",
      place: "Field 2",
      notes: "Bring a pen.",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Tomorrow: your check-in table shift");
    expect(result.value.text).toContain(
      "check-in table at Fall Social game day: Tue, Oct 20, 6:00 – 6:45 PM, Field 2.",
    );
    expect(result.value.text).toContain("Bring a pen.");
    expect(result.value.text).toContain(
      "https://league.example.test/app/volunteer",
    );
  });

  it("refuses a payload without a time", () => {
    expect(render("volunteer_reminder", { role: "Setup" }).ok).toBe(false);
  });
});

describe("the survey invite", () => {
  it("asks about the season, says it's anonymous and links to it", () => {
    const result = render("survey_invite", {
      seasonName: "Fall Social",
      seasonSlug: "fall-social",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("How was Fall Social?");
    expect(result.value.text).toContain("anonymous");
    expect(result.value.text).toContain(
      "https://league.example.test/app/seasons/fall-social/survey",
    );
  });
});
