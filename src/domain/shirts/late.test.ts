import { describe, expect, it } from "vitest";
import {
  BATCH_MINIMUM,
  parseDesign,
  parseSpare,
  summarizeWaiting,
} from "./late";

const players = (n: number, teamName: string, size: "m" | "l" | "xl") =>
  Array.from({ length: n }, () => ({ teamName, size }));

describe("summarizeWaiting", () => {
  it("counts the waiting list across teams by size and by team", () => {
    const s = summarizeWaiting(
      [
        ...players(3, "Zebras", "m"),
        ...players(2, "Aces", "m"),
        ...players(1, "Aces", "l"),
      ],
      {},
    );
    expect(s.total).toBe(6);
    expect(s.bySize.m).toBe(5);
    expect(s.byTeam.map((t) => [t.teamName, t.total])).toEqual([
      ["Aces", 3],
      ["Zebras", 3],
    ]);
    expect(s.batchReady).toBe(false);
    expect(s.stillNeeded).toBe(BATCH_MINIMUM - 6);
  });

  it("is ready once enough have built up across teams", () => {
    const s = summarizeWaiting(
      [...players(6, "Aces", "m"), ...players(6, "Zebras", "l")],
      {},
    );
    expect(s.batchReady).toBe(true);
    expect(s.stillNeeded).toBe(0);
  });

  it("covers a size from spare stock before counting toward a batch", () => {
    const s = summarizeWaiting(
      [...players(8, "Aces", "m"), ...players(4, "Zebras", "l")],
      { m: 3, xl: 10 },
    );
    expect(s.afterSpares.m).toBe(5);
    expect(s.afterSpares.l).toBe(4);
    expect(s.toOrder).toBe(9);
    // Spare xl never reduces another size.
    expect(s.batchReady).toBe(false);
  });

  it("handles an empty list", () => {
    const s = summarizeWaiting([], { m: 2 });
    expect(s.total).toBe(0);
    expect(s.toOrder).toBe(0);
    expect(s.batchReady).toBe(false);
  });
});

describe("parseSpare", () => {
  it("reads a size, a count and a note", () => {
    expect(
      parseSpare({ size: "m", quantity: " 4 ", note: " from fall " }),
    ).toEqual({
      ok: true,
      value: { size: "m", quantity: 4, note: "from fall" },
    });
  });
  it("refuses a bad size, count or long note", () => {
    expect(parseSpare({ size: "mm", quantity: "1", note: "" })).toEqual({
      ok: false,
      error: "bad_size",
    });
    for (const quantity of ["0", "-2", "1.5", "501", ""])
      expect(parseSpare({ size: "m", quantity, note: "" })).toEqual({
        ok: false,
        error: "bad_quantity",
      });
    expect(
      parseSpare({ size: "m", quantity: "1", note: "x".repeat(201) }),
    ).toEqual({ ok: false, error: "note_too_long" });
  });
});

describe("parseDesign", () => {
  it("trims, collapses spaces, and clears when empty", () => {
    expect(parseDesign("  Red   with  white sleeves ")).toEqual({
      ok: true,
      value: "Red with white sleeves",
    });
    expect(parseDesign("   ")).toEqual({ ok: true, value: null });
    expect(parseDesign("x".repeat(121))).toEqual({
      ok: false,
      error: "design_too_long",
    });
  });
});
