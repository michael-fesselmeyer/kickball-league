import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

const base = {
  seasonName: "Fall 2026",
  length: "1 game",
  scope: "games",
  leagueName: "Kickball League",
  leagueEmail: "league@example.test",
};

describe("the suspension email", () => {
  it("gives the length, what it blocks and how to appeal", () => {
    const result = render("suspension", base);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("You're suspended: 1 game");
    expect(result.value.text).toContain(
      "Kickball League has suspended you for 1 game in Fall 2026.",
    );
    expect(result.value.text).toContain("counts down");
    expect(result.value.text).toContain("can't RSVP");
    expect(result.value.text).toContain(
      "reply to this email or write to league@example.test",
    );
  });

  it("words a permanent ban plainly, and appeals by reply without an address", () => {
    const result = render("suspension", {
      ...base,
      length: "permanently",
      scope: "permanent",
      leagueEmail: null,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).toContain(
      "has banned you from playing, permanently.",
    );
    expect(result.value.text).toContain("To appeal, reply to this email and");
  });

  it("refuses a payload that doesn't match", () => {
    expect(render("suspension", { ...base, scope: "week" }).ok).toBe(false);
  });
});
