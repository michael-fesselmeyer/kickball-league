import { describe, expect, it } from "vitest";
import { gameKey } from "@/domain/scheduler/types";
import { slotId } from "@/domain/scheduler/worked-example.fixture";
import { boardSlots, input, schedule } from "./board.fixture";
import {
  applyAll,
  boardGrid,
  compareViolations,
  editFor,
  gamesInViolation,
  placeOf,
  stateOf,
  step,
} from "./board-model";

// Week 1 of the optimized example: B-G at 10:00 on field 1; field 2 is free.
const bg = gameKey(1, "B", "G");
const de = gameKey(1, "D", "E");
const emptyWeek1 = slotId(0, 1, 0);

describe("boardGrid", () => {
  it("draws a row per date and time and a column per field", () => {
    const grid = boardGrid(boardSlots());
    expect(grid.fields).toEqual([
      { id: "F1", label: "Field 1" },
      { id: "F2", label: "Field 2" },
    ]);
    expect(grid.rows).toHaveLength(21);
    expect(grid.rows[0]).toMatchObject({
      date: "2027-04-04",
      time: "10:00 AM",
    });
    expect(grid.rows[0]!.cells.map((c) => c?.id)).toEqual([
      slotId(0, 0, 0),
      slotId(0, 1, 0),
    ]);
  });

  it("leaves out playoff slots and marks a missing field as no slot", () => {
    const slots = boardSlots().filter((s) => s.id !== slotId(0, 1, 0));
    slots.push({ ...slots[0]!, id: "playoff", kind: "playoff" });
    const grid = boardGrid(slots);
    expect(grid.rows).toHaveLength(21);
    expect(grid.rows[0]!.cells[1]).toBeNull();
  });
});

describe("editFor", () => {
  it("moves to an empty slot, swaps with a game, and ignores its own slot", () => {
    expect(editFor(schedule, bg, emptyWeek1)).toEqual({
      ok: true,
      value: { kind: "move", gameKey: bg, slotId: emptyWeek1 },
    });
    expect(editFor(schedule, bg, slotId(0, 0, 1))).toEqual({
      ok: true,
      value: { kind: "swap", gameKeys: [bg, de] },
    });
    expect(editFor(schedule, bg, slotId(0, 0, 0))).toEqual({
      ok: true,
      value: null,
    });
  });

  it("reports a game that is not in the schedule", () => {
    const result = editFor(schedule, "r9:X:Y", emptyWeek1);
    expect(result.ok).toBe(false);
  });
});

describe("step and applyAll", () => {
  const saved = stateOf(input, schedule);

  it("starts from a valid schedule", () => {
    expect(saved.violations).toEqual([]);
    expect(saved.metrics.unplaced.value).toBe(0);
  });

  it("moves a game and pins it there", () => {
    const result = step(
      saved,
      { kind: "move", gameKey: bg, slotId: emptyWeek1 },
      true,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.schedule.games.find((g) => g.key === bg)?.slotId).toBe(
      emptyWeek1,
    );
    expect(result.value.input.locked).toEqual([
      { gameKey: bg, slotId: emptyWeek1 },
    ]);
  });

  it("leaves pins alone when asked not to pin", () => {
    const result = step(saved, { kind: "swap", gameKeys: [bg, de] }, false);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.input.locked).toEqual([]);
  });

  it("reports a game moved onto another week's date as a hard-rule problem", () => {
    // B already plays in week 2, so a second game that day breaks a rule.
    const result = step(
      saved,
      { kind: "move", gameKey: bg, slotId: slotId(1, 0, 2) },
      true,
    );
    if (!result.ok) throw new Error(result.error.message);
    const { added, fixed } = compareViolations(
      saved.violations,
      result.value.violations,
    );
    expect(added.length).toBeGreaterThan(0);
    expect(fixed).toEqual([]);
    expect(gamesInViolation(result.value.violations).has(bg)).toBe(true);

    const back = step(
      result.value,
      { kind: "move", gameKey: bg, slotId: slotId(0, 0, 0) },
      true,
    );
    if (!back.ok) throw new Error(back.error.message);
    expect(
      compareViolations(result.value.violations, back.value.violations).fixed,
    ).toEqual(result.value.violations);
  });

  it("applies edits in order, and none gives the saved state", () => {
    expect(applyAll(saved, [], true)).toEqual({ ok: true, value: saved });
    const result = applyAll(
      saved,
      [
        { kind: "move", gameKey: bg, slotId: emptyWeek1 },
        { kind: "swap", gameKeys: [bg, de] },
      ],
      true,
    );
    if (!result.ok) throw new Error(result.error.message);
    const where = new Map(result.value.schedule.games.map((g) => [g.key, g]));
    expect(where.get(bg)?.slotId).toBe(slotId(0, 0, 1));
    expect(where.get(de)?.slotId).toBe(emptyWeek1);
  });

  it("stops at the first edit that fails", () => {
    const result = applyAll(
      saved,
      [
        { kind: "move", gameKey: bg, slotId: emptyWeek1 },
        { kind: "move", gameKey: de, slotId: emptyWeek1 },
      ],
      true,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "slot_taken" } });
  });
});

it("names a slot by day, time and field", () => {
  expect(placeOf(boardSlots()[0]!)).toBe("2027-04-04, 10:00 AM, Field 1");
});
