import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });
const about = {
  seasonName: "Spring 2027",
  seasonSlug: "spring-2027",
  team: "Kick Bottom",
};

describe("captain and co-captain emails", () => {
  it("asks the teammate to answer the offer on their team page", () => {
    const result = render("captain_handoff", {
      ...about,
      kind: "offered",
      captain: "Robin E.",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe(
      "Robin E. asked you to captain Kick Bottom",
    );
    expect(result.value.text).toContain("Nothing changes until you say yes.");
    expect(result.value.text).toContain(
      "https://league.example.test/app/seasons/spring-2027/team",
    );
  });

  it("tells the old captain the answer", () => {
    const yes = render("team_role", {
      ...about,
      kind: "accepted",
      player: "Sam E.",
    });
    const no = render("team_role", {
      ...about,
      kind: "declined",
      player: "Sam E.",
    });
    if (!yes.ok || !no.ok) throw new Error("did not render");
    expect(yes.value.text).toContain("You stay on as a co-captain");
    expect(no.value.subject).toBe("Sam E. won't take over Kick Bottom");
  });

  it("tells a teammate they became a co-captain or a player again", () => {
    const co = render("team_role", { ...about, kind: "co_captain" });
    const back = render("team_role", { ...about, kind: "player" });
    if (!co.ok || !back.ok) throw new Error("did not render");
    expect(co.value.subject).toBe("You're a co-captain of Kick Bottom");
    expect(back.value.subject).toBe(
      "You're no longer a co-captain of Kick Bottom",
    );
  });

  it("refuses a payload of the wrong shape", () => {
    expect(render("team_role", { ...about, kind: "offered" }).ok).toBe(false);
  });
});
