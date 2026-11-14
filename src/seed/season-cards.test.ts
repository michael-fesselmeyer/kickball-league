import { describe, expect, it } from "vitest";
import { PERSONA_EMAILS } from "@/lib/demo/personas";
import { generateSeed } from "./generate";
import { generatePastSeasons } from "./past-seasons";
import { inningsFor, seasonCardSeedRows } from "./season-cards";

const data = generateSeed();
const rows = seasonCardSeedRows(data);
const summer = generatePastSeasons(data).seasons.find(
  (s) => s.season.slug === "summer-2026",
);

describe("seeded season cards", () => {
  it("puts six players on one Summer 2026 team, one of them its captain", () => {
    expect(rows.seasonId).toBe(summer?.season.id);
    expect(rows.registrations).toHaveLength(6);
    expect(new Set(rows.memberships.map((m) => m.teamSeasonId)).size).toBe(1);
    expect(rows.memberships.filter((m) => m.role === "captain")).toHaveLength(
      1,
    );
    const users = new Set(rows.registrations.map((r) => r.userId));
    expect(users.size).toBe(6);
    expect(users.has(rows.publicPlayer)).toBe(true);
  });

  it("leaves the demo personas out", () => {
    const emails = new Set(
      data.users
        .filter((u) => rows.registrations.some((r) => r.userId === u.id))
        .map((u) => u.email),
    );
    for (const persona of PERSONA_EMAILS)
      expect(emails.has(persona)).toBe(false);
  });

  it("scores the live game half by half to its final score", () => {
    const live = summer?.games.find((g) => g.id === rows.kicksFirst?.gameId);
    const sum = (half: "top" | "bottom") =>
      rows.periods
        .filter((p) => p.half === half)
        .reduce((total, p) => total + p.runs, 0);
    expect(sum("top")).toBe(live?.scoreA);
    expect(sum("bottom")).toBe(live?.scoreB);
    expect(rows.kicksFirst?.team).toBe(live?.teamAId);
  });

  it("has a closed MVP poll with one vote each, never for yourself", () => {
    expect(rows.poll.closesAt.getTime()).toBeGreaterThan(
      rows.poll.opensAt.getTime(),
    );
    expect(rows.votes).toHaveLength(6);
    for (const v of rows.votes) expect(v.nomineeUserId).not.toBe(v.voterId);
  });
});

describe("inningsFor", () => {
  it("adds up to the score with one big inning", () => {
    for (const score of [0, 3, 6, 12]) {
      const innings = inningsFor(score);
      expect(innings).toHaveLength(7);
      expect(innings.reduce((a, b) => a + b, 0)).toBe(score);
    }
    expect(Math.max(...inningsFor(12))).toBe(8);
  });
});
