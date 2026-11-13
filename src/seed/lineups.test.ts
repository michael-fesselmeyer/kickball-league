import { describe, expect, it } from "vitest";
import { generateSeed } from "./generate";
import { seedLineupRows } from "./lineups";

describe("seedLineupRows", () => {
  const data = generateSeed();
  const rows = seedLineupRows(data);

  it("has ten players in for each of the two games", () => {
    expect(rows.rsvps).toHaveLength(20);
    expect(new Set(rows.rsvps.map((r) => r.gameId)).size).toBe(2);
  });

  it("saves a valid order for the earlier game and one break for the later", () => {
    expect(rows.lineups.map((l) => l.runBreaks)).toEqual([0, 1]);
    expect(rows.spots).toHaveLength(20);
  });

  it("only puts players who said they're in into an order", () => {
    for (const spot of rows.spots) {
      const lineup = rows.lineups.find((l) => l.id === spot.lineupId);
      expect(
        rows.rsvps.some(
          (r) => r.gameId === lineup?.gameId && r.userId === spot.userId,
        ),
      ).toBe(true);
    }
  });

  it("gives the ref the later game", () => {
    expect(rows.refereeAssignment.gameId).toBe(rows.lineups[1]?.gameId);
  });
});
