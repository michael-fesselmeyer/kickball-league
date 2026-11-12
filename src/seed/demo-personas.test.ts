import { describe, expect, it } from "vitest";
import { PERSONA_EMAILS } from "@/lib/demo/personas";
import { demoPersonaRows } from "./demo-personas";
import { generateSeed, PLAYED_ROUNDS } from "./generate";

describe("demoPersonaRows", () => {
  const data = generateSeed();
  const rows = demoPersonaRows(data);

  it("adds exactly the four personas, with fixed ids", () => {
    expect(rows.users.map((u) => u.email)).toEqual(PERSONA_EMAILS);
    expect(demoPersonaRows(generateSeed(7)).users).toEqual(rows.users);
    const seeded = new Set(data.users.map((u) => u.id));
    for (const u of rows.users) expect(seeded.has(u.id)).toBe(false);
  });

  it("makes only the admin persona an admin", () => {
    expect(
      rows.profiles
        .filter((p) => p.globalRole === "admin")
        .map((p) => p.userId),
    ).toEqual([rows.users[3]?.id]);
  });

  it("makes Casey the first team's only captain once the generated captain steps aside", () => {
    const team = data.teamSeasons[0]?.id;
    const handOff = data.rosterMemberships.find(
      (m) => m.id === rows.handOffMembershipId,
    );
    expect(handOff).toMatchObject({ teamSeasonId: team, role: "captain" });
    expect(rows.rosterMemberships.map((m) => [m.teamSeasonId, m.role])).toEqual(
      [
        [team, "captain"],
        [team, "player"],
      ],
    );
    expect(rows.team).toEqual({
      id: team,
      targetRosterSize: (data.teamSeasons[0]?.targetRosterSize ?? 0) + 2,
    });
    for (const m of rows.rosterMemberships)
      expect(rows.registrations.some((r) => r.id === m.registrationId)).toBe(
        true,
      );
  });

  it("gives the ref finished games and games still to score, one ref per game", () => {
    const games = new Map(data.games.map((g) => [g.id, g]));
    const assigned = rows.refereeAssignments.map((a) => games.get(a.gameId));
    expect(assigned.some((g) => g?.status === "final")).toBe(true);
    expect(assigned.some((g) => g?.status === "scheduled")).toBe(true);
    expect(new Set(assigned.map((g) => g?.roundNo))).toEqual(
      new Set([PLAYED_ROUNDS, PLAYED_ROUNDS + 1]),
    );
    expect(new Set(rows.refereeAssignments.map((a) => a.gameId)).size).toBe(
      rows.refereeAssignments.length,
    );
  });
});
