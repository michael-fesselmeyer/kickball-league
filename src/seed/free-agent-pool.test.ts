import { describe, expect, it } from "vitest";
import { suggestPlacements } from "@/domain/matcher/matcher";
import { normalizeFriendCode } from "@/domain/matcher/friend-code";
import { generateSeed, SEED_EMAIL_DOMAIN } from "./generate";
import { generateFreeAgentPool } from "./free-agent-pool";

const data = generateSeed();
const pool = generateFreeAgentPool(data);

describe("the seeded free-agent pool", () => {
  it("registers everyone for the spring season on the seed domain", () => {
    for (const r of pool.rows) {
      expect(r.registration.seasonId).toBe(data.nextSeason.id);
      expect(r.user.email.endsWith(`@${SEED_EMAIL_DOMAIN}`)).toBe(true);
    }
    const seeded = new Set(data.users.map((u) => u.id as string));
    for (const r of pool.rows) expect(seeded.has(r.user.id)).toBe(false);
  });

  it("uses real friend codes and fills the matcher with suggestions", () => {
    for (const g of pool.groups)
      expect(normalizeFriendCode(g.code)).toBe(g.code);
    const result = suggestPlacements(
      pool.rows.map((r, order) => ({
        registrationId: r.registration.id,
        name: r.user.name,
        side: r.profile.lineupGender,
        skill: r.quiz?.skillScore ?? null,
        vibe: r.quiz?.vibeScore ?? null,
        availability: r.quiz?.answers.availability ?? null,
        positions: r.quiz?.answers.positions ?? [],
        groupId: r.registration.friendGroupId,
        captain: r.quiz?.answers.captain ?? null,
        order,
      })),
      data.nextTeamSeasons.map((t, i) => ({
        teamSeasonId: t.id,
        name: data.teams[i]?.name ?? "",
        capacity: t.targetRosterSize,
        members: [],
      })),
    );
    expect(result.unplaced).toEqual([]);
    expect(result.suggestions.length).toBeGreaterThan(5);
  });
});
