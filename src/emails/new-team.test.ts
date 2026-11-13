import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });
const about = {
  seasonName: "Spring 2027",
  seasonSlug: "spring-2027",
  team: "Kick Bottom",
};

describe("new-team emails", () => {
  it("tells the requester their team is approved and where to invite", () => {
    const result = render("new_team", { ...about, kind: "approved" });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Kick Bottom is in for Spring 2027");
    expect(result.value.text).toContain("with you as captain");
    expect(result.value.text).toContain(
      "https://league.example.test/app/seasons/spring-2027/team",
    );
    expect(result.value.text).toContain(
      "because you asked to start Kick Bottom",
    );
  });

  it("passes on the league's reason for a decline, when there is one", () => {
    const withReason = render("new_team", {
      ...about,
      kind: "declined",
      reason: "The season is full.",
    });
    if (!withReason.ok) throw new Error(withReason.error);
    expect(withReason.value.text).toContain(
      "From the league: The season is full.",
    );
    const without = render("new_team", {
      ...about,
      kind: "declined",
      reason: null,
    });
    expect(without.ok && without.value.text).not.toContain("From the league");
  });

  it("tells the old captain who left and for which team", () => {
    const result = render("new_team", {
      ...about,
      kind: "player_left",
      player: "Sam E.",
      leftTeam: "Base Invaders",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Sam E. is starting a new team");
    expect(result.value.text).toContain("because you captain Base Invaders");
  });

  it("refuses a payload that does not match", () => {
    expect(render("new_team", { ...about, kind: "player_left" }).ok).toBe(
      false,
    );
  });
});
