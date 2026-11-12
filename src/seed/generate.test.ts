import { describe, expect, it } from "vitest";
import {
  generateSeed,
  newYorkTime,
  PLAYED_ROUNDS,
  ROSTER_SIZE,
  roundRobin,
  SEED_EMAIL_DOMAIN,
  TEAMS,
} from "./generate";
import { seededRandom } from "./random";

describe("seededRandom", () => {
  it("repeats exactly for the same seed and differs for another", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(first);
  });

  it("keeps int() inside its bounds", () => {
    const random = seededRandom(1);
    for (let i = 0; i < 1000; i++) {
      const n = random.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it("shuffles without losing or adding items, and refuses an empty pick", () => {
    const random = seededRandom(2);
    expect(random.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
    expect(() => random.pick([])).toThrow();
  });
});

describe("newYorkTime", () => {
  it("handles daylight saving: 10:00 is 14:00 UTC in September and 15:00 UTC in November", () => {
    expect(newYorkTime("2026-09-13", 10).toISOString()).toBe(
      "2026-09-13T14:00:00.000Z",
    );
    expect(newYorkTime("2026-11-08", 10).toISOString()).toBe(
      "2026-11-08T15:00:00.000Z",
    );
  });
});

describe("roundRobin", () => {
  it("pairs every team with every other exactly once, each team once per round", () => {
    const rounds = roundRobin(8);
    expect(rounds).toHaveLength(7);
    const meetings = new Set<string>();
    for (const pairs of rounds) {
      const seen = pairs.flat();
      expect(new Set(seen).size).toBe(8);
      for (const [a, b] of pairs) meetings.add([a, b].sort().join("-"));
    }
    expect(meetings.size).toBe(28);
  });
});

describe("generateSeed", () => {
  const data = generateSeed();

  it("is deterministic", () => {
    expect(generateSeed()).toEqual(data);
    expect(generateSeed(99).league.id).not.toBe(data.league.id);
  });

  it("creates 8 teams with full rosters and exactly one captain each", () => {
    expect(data.teams.map((t) => t.name)).toEqual(TEAMS.map((t) => t.name));
    for (const entry of data.teamSeasons) {
      const roster = data.rosterMemberships.filter(
        (m) => m.teamSeasonId === entry.id,
      );
      expect(roster).toHaveLength(ROSTER_SIZE);
      expect(roster.filter((m) => m.role === "captain")).toHaveLength(1);
    }
    expect(ROSTER_SIZE).toBeGreaterThanOrEqual(data.season.rosterMin);
    expect(ROSTER_SIZE).toBeLessThanOrEqual(data.season.rosterMax);
  });

  it("puts every player on one team, with one registration each", () => {
    const registered = data.registrations.map((r) => r.userId);
    expect(new Set(registered).size).toBe(registered.length);
    const onRosters = data.rosterMemberships.map((m) => m.registrationId);
    expect(new Set(onRosters).size).toBe(onRosters.length);
  });

  it("uses only invented names on the reserved seed email domain", () => {
    expect(
      data.users.every((u) => u.email.endsWith(`@${SEED_EMAIL_DOMAIN}`)),
    ).toBe(true);
    expect(new Set(data.users.map((u) => u.email)).size).toBe(
      data.users.length,
    );
    expect(data.profiles.filter((p) => p.globalRole === "admin")).toHaveLength(
      1,
    );
  });

  it("schedules a full round robin, with the early rounds played", () => {
    expect(data.games).toHaveLength(28);
    const final = data.games.filter((g) => g.status === "final");
    expect(final).toHaveLength(PLAYED_ROUNDS * 4);
    for (const game of final) {
      expect(game.scoreA).toBeGreaterThanOrEqual(0);
      expect(game.scoreB).toBeGreaterThanOrEqual(0);
      expect(game.finalizedAt).not.toBeNull();
    }
    expect(data.games.every((g) => g.teamAId !== g.teamBId)).toBe(true);
  });

  it("never double-books a slot", () => {
    const used = data.games.map((g) => g.slotId);
    expect(new Set(used).size).toBe(used.length);
  });
});
