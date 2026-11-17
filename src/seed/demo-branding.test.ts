import { describe, expect, it } from "vitest";
import { demoBranding, teamRenames } from "./demo-branding";
import { TEAMS } from "./generate";
import { RETIRED_TEAMS } from "./past-seasons";

// Invented names only: the real ones never enter the repository.
const NAMES = ["Tidepool Toads", "Lantern Legs", "Foghorn Feet"];

describe("demoBranding", () => {
  it("is empty without the variables, so the reset changes nothing", () => {
    expect(demoBranding({})).toEqual({ leagueName: null, teamNames: [] });
  });

  it("reads the league's name and the team list", () => {
    expect(
      demoBranding({
        SITE_NAME: " Harbor Lights ",
        DEMO_TEAM_NAMES: JSON.stringify(NAMES),
      }),
    ).toEqual({ leagueName: "Harbor Lights", teamNames: NAMES });
  });

  it("refuses a team list that isn't a list of names", () => {
    expect(() => demoBranding({ DEMO_TEAM_NAMES: '{"a":1}' })).toThrow(
      "DEMO_TEAM_NAMES must be a JSON list",
    );
    expect(() => demoBranding({ DEMO_TEAM_NAMES: '["ok", ""]' })).toThrow(
      "DEMO_TEAM_NAMES must be a JSON list",
    );
  });
});

describe("teamRenames", () => {
  const seeded = [...RETIRED_TEAMS, ...TEAMS]
    .map((t) => ({ slug: t.slug }))
    .reverse();

  it("renames the seed's teams in the seed's order", () => {
    const renames = teamRenames(seeded, NAMES);
    expect(renames.map((r) => [r.team.slug, r.name])).toEqual([
      [TEAMS[0]!.slug, NAMES[0]],
      [TEAMS[1]!.slug, NAMES[1]],
      [TEAMS[2]!.slug, NAMES[2]],
    ]);
  });

  it("reaches the retired teams after this season's, then any other team", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Team ${i + 1}`);
    const renames = teamRenames([...seeded, { slug: "a-new-team" }], names);
    expect(renames.map((r) => r.team.slug)).toEqual([
      ...TEAMS.map((t) => t.slug),
      ...RETIRED_TEAMS.map((t) => t.slug),
      "a-new-team",
    ]);
  });

  it("leaves extra names unused and keeps teams without one", () => {
    expect(teamRenames(seeded.slice(0, 2), NAMES)).toHaveLength(2);
    expect(teamRenames(seeded, [])).toEqual([]);
  });
});
