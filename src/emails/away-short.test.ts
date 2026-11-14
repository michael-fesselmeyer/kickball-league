import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });
const payload = {
  seasonName: "Fall 2026",
  seasonSlug: "fall-2026",
  team: "Kick Bottom",
  week: "Oct 5 – Oct 11",
  player: "Jo S.",
  available: 9,
  fielding:
    "Short-handed: you can field 9 (5 and 4), a lineup the rulebook allows.",
  games: [{ opponent: "Base Invaders", when: "Mon, Oct 5, 8:00 PM" }],
  gameId: "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b",
  subsOpen: true,
};

describe("away-short email", () => {
  it("tells a captain the week is short and links to a sub request", () => {
    const result = render("away_short", payload);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe(
      "Kick Bottom may be short the week of Oct 5 – Oct 11",
    );
    expect(result.value.text).toContain(
      "Jo S. will be away that week, so 9 of your players are available for Mon, Oct 5, 8:00 PM vs Base Invaders.",
    );
    expect(result.value.text).toContain(
      `https://league.example.test/app/seasons/fall-2026/team/subs?game=${payload.gameId}#ask`,
    );
    expect(result.value.text).toContain(
      "because you captain Kick Bottom in Fall 2026",
    );
  });

  it("points to the team page when sub requests are closed for the game", () => {
    const result = render("away_short", { ...payload, subsOpen: false });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).toContain("Sub requests aren't open");
    expect(result.value.text).toContain(
      `https://league.example.test/app/seasons/fall-2026/team#game-${payload.gameId}`,
    );
  });

  it("refuses a payload without a game", () => {
    expect(render("away_short", { ...payload, games: [] }).ok).toBe(false);
  });
});
