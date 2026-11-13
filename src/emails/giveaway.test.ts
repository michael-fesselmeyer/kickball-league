import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

describe("the giveaway winner's message", () => {
  it("says what they won and links to the giveaway", () => {
    const result = render("giveaway_win", {
      prize: "A $50 bar tab",
      donatedBy: "The Kick Bar",
      eventTitle: "Spring bar night",
      eventSlug: "spring-bar-night",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("You won the Spring bar night giveaway");
    expect(result.value.text).toContain("A $50 bar tab, from The Kick Bar");
    expect(result.value.text).toContain(
      "https://league.example.test/app/events/spring-bar-night/giveaway",
    );
  });

  it("refuses a payload without a prize", () => {
    expect(render("giveaway_win", { eventTitle: "x" }).ok).toBe(false);
  });
});
