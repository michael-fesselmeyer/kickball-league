import { describe, expect, it } from "vitest";
import { PERSONA_EMAILS } from "@/lib/demo/personas";
import { DISCIPLINE_TEAM, disciplinePlayerRows } from "./discipline";
import { generateSeed } from "./generate";

describe("disciplinePlayerRows", () => {
  const data = generateSeed();
  const rows = disciplinePlayerRows(data);

  it("adds one invented player with fixed ids, apart from the personas", () => {
    expect(rows.user.email).toMatch(/@example\.test$/);
    expect(PERSONA_EMAILS).not.toContain(rows.user.email);
    expect(disciplinePlayerRows(generateSeed(7)).user).toEqual(rows.user);
    const seeded = new Set(data.users.map((u) => u.id));
    expect(seeded.has(rows.user.id)).toBe(false);
    expect(rows.profile.globalRole).toBe("player");
  });

  it("puts them on Foul Play in the fall season, as a player", () => {
    const team = data.teams.find((t) => t.name === DISCIPLINE_TEAM);
    const entry = data.teamSeasons.find((t) => t.teamId === team?.id);
    expect(rows.registration.seasonId).toBe(data.season.id);
    expect(rows.rosterMembership).toMatchObject({
      teamSeasonId: entry?.id,
      registrationId: rows.registration.id,
      role: "player",
      status: "active",
    });
    expect(rows.team.targetRosterSize).toBe((entry?.targetRosterSize ?? 0) + 1);
  });
});
