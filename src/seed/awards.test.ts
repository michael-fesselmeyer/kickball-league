import { describe, expect, it } from "vitest";
import { pollState, tally } from "@/domain/awards/awards";
import { seedAwardRows } from "./awards";
import { generateSeed, PLAYED_ROUNDS } from "./generate";

const data = generateSeed();
const NOW = new Date("2026-11-12T15:00:00Z");
const { polls, votes } = seedAwardRows(data, NOW);
const teamOf = new Map(
  data.rosterMemberships.map((m) => [
    data.registrations.find((r) => r.id === m.registrationId)?.userId,
    m.teamSeasonId,
  ]),
);
const played = new Set(
  data.games
    .filter((g) => g.roundNo === PLAYED_ROUNDS)
    .flatMap((g) => [g.teamAId, g.teamBId]),
);

describe("seeded awards", () => {
  it("has a closed game-day MVP and two open polls", () => {
    expect(polls.map((p) => [p.title, pollState(p, NOW)])).toEqual([
      ["MVP, Tue, Oct 6", "closed"],
      ["Fall 2026 Best sport", "open"],
      ["Team spirit, Tue, Oct 6", "open"],
    ]);
  });

  it("follows the voting rules: one vote each, never yourself or your team", () => {
    const keys = votes.map((v) => `${v.awardPollId}/${v.voterId}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const v of votes) {
      expect(teamOf.has(v.voterId)).toBe(true);
      if ("nomineeUserId" in v) {
        expect(v.nomineeUserId).not.toBe(v.voterId);
        expect(played.has(teamOf.get(v.nomineeUserId)!)).toBe(true);
      } else {
        expect(v.nomineeTeamSeasonId).not.toBe(teamOf.get(v.voterId));
        expect(played.has(v.nomineeTeamSeasonId)).toBe(true);
      }
    }
  });

  it("leaves the open polls to the demo player's team, and crowns an MVP", () => {
    const demoTeam = data.teamSeasons[0]?.id;
    const open = new Set(
      polls.filter((p) => pollState(p, NOW) === "open").map((p) => p.id),
    );
    expect(
      votes.filter(
        (v) => open.has(v.awardPollId) && teamOf.get(v.voterId) === demoTeam,
      ),
    ).toEqual([]);
    const mvp = votes.flatMap((v) =>
      v.awardPollId === polls[0]?.id && "nomineeUserId" in v
        ? [{ nomineeId: v.nomineeUserId, votes: 1 }]
        : [],
    );
    expect(tally(mvp).total).toBeGreaterThan(10);
  });
});
