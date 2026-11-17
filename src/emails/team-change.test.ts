import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });
const about = {
  seasonName: "Spring 2027",
  seasonSlug: "spring-2027",
  team: "Kick Bottom",
};

describe("looking-for-a-change emails", () => {
  it("tells the player the team doesn't know who they are", () => {
    const result = render("move_invite", {
      ...about,
      message: "Tuesdays, friendly, we love a pitcher.",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Kick Bottom would like you next season");
    expect(result.value.text).toContain("They don't know who you are.");
    expect(result.value.text).toContain("we love a pitcher");
    expect(result.value.text).toContain(
      "https://league.example.test/app/change-team",
    );
    // Neutral: it never asks or guesses why.
    expect(result.value.text).not.toMatch(/\bwhy\b|reason/i);
  });

  it("leaves the pitch out when the captain wrote none", () => {
    const result = render("move_invite", { ...about, message: null });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).not.toContain("From their captain");
  });

  it("names the player to the captain only once they said yes", () => {
    const result = render("move_accepted", { ...about, player: "Robin E." });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Robin E. said yes to Kick Bottom");
    expect(result.value.text).toContain(
      "https://league.example.test/app/seasons/spring-2027/team?view=roster#recruiting",
    );
  });
});
