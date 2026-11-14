import { describe, expect, it } from "vitest";
import { generateSeed } from "./generate";
import { seedPickRows } from "./pickem";

describe("seed pick'em", () => {
  const data = generateSeed();
  const rows = seedPickRows(data);

  it("picks only played games, once per player, for a team in the game", () => {
    const games = new Map(data.games.map((g) => [g.id as string, g]));
    const seen = new Set<string>();
    for (const r of rows) {
      const g = games.get(r.gameId);
      expect(g?.status).toBe("final");
      expect([g?.teamAId, g?.teamBId]).toContain(r.teamSeasonId);
      expect(r.slotId).toBe(g?.slotId);
      const key = `${r.gameId}:${r.userId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(rows.length).toBeGreaterThan(100);
  });

  it("is the same every time", () => {
    expect(seedPickRows(data)).toEqual(rows);
  });
});
