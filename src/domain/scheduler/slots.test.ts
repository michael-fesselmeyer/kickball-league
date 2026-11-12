import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateSlots, localDate } from "./slots";
import type { Blackout, PermitWindow } from "./types";

const NY = { slotMinutes: 60, timeZone: "America/New_York" };

/** 8 to 10 pm New York time on a Tuesday in October (EDT, UTC-4). */
const tuesday = (fieldId: string): PermitWindow => ({
  fieldId,
  startsAt: "2026-10-06T00:00:00.000Z",
  endsAt: "2026-10-06T02:00:00.000Z",
});

describe("generateSlots", () => {
  it("cuts a window into back-to-back slots on the local date", () => {
    const slots = generateSlots([tuesday("f1")], [], NY);
    expect(slots.map((s) => [s.date, s.startsAt, s.timeIndex])).toEqual([
      ["2026-10-05", "2026-10-06T00:00:00.000Z", 0],
      ["2026-10-05", "2026-10-06T01:00:00.000Z", 1],
    ]);
  });

  it("numbers time slots in clock order across all fields", () => {
    const slots = generateSlots([tuesday("f1"), tuesday("f2")], [], NY);
    expect(slots.map((s) => `${s.fieldId}:${s.timeIndex}`)).toEqual([
      "f1:0",
      "f2:0",
      "f1:1",
      "f2:1",
    ]);
  });

  it("drops a leftover too short for a game", () => {
    const window = { ...tuesday("f1"), endsAt: "2026-10-06T01:30:00.000Z" };
    expect(generateSlots([window], [], NY)).toHaveLength(1);
  });

  it("applies blackouts to a whole date or a single field", () => {
    const windows = [tuesday("f1"), tuesday("f2")];
    expect(generateSlots(windows, [{ date: "2026-10-05" }], NY)).toEqual([]);
    const oneField = generateSlots(
      windows,
      [{ date: "2026-10-05", fieldId: "f1" }],
      NY,
    );
    expect(new Set(oneField.map((s) => s.fieldId))).toEqual(new Set(["f2"]));
  });

  it("never overlaps slots when permits on a field overlap", () => {
    const shifted = {
      fieldId: "f1",
      startsAt: "2026-10-06T00:30:00.000Z",
      endsAt: "2026-10-06T02:30:00.000Z",
    };
    const slots = generateSlots([tuesday("f1"), shifted], [], NY);
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2026-10-06T00:00:00.000Z",
      "2026-10-06T01:00:00.000Z",
    ]);
  });

  it("keeps ids stable and carries the window's kind", () => {
    const window = { ...tuesday("f1"), kind: "playoff" as const };
    const first = generateSlots([window], [], NY);
    expect(generateSlots([window], [], NY)).toEqual(first);
    expect(first[0]?.id).toBe("f1@2026-10-06T00:00:00.000Z");
    expect(first.every((s) => s.kind === "playoff")).toBe(true);
  });

  it("rejects a slot length that is not positive", () => {
    expect(() => generateSlots([], [], { ...NY, slotMinutes: 0 })).toThrow();
  });

  it("dates a 9 pm New York game on its local day, across the daylight-saving change", () => {
    expect(
      localDate(new Date("2026-11-04T02:00:00Z"), "America/New_York"),
    ).toBe("2026-11-03");
    expect(
      localDate(new Date("2026-10-07T01:00:00Z"), "America/New_York"),
    ).toBe("2026-10-06");
  });
});

/** Random permit windows on up to 3 fields over a few days, plus blackouts. */
const scenario = fc
  .record({
    windows: fc.array(
      fc.record({
        field: fc.constantFrom("f1", "f2", "f3"),
        day: fc.integer({ min: 0, max: 6 }),
        startMinute: fc.integer({ min: 0, max: 23 * 60 }),
        lengthMinutes: fc.integer({ min: 0, max: 8 * 60 }),
      }),
      { maxLength: 8 },
    ),
    blackouts: fc.array(
      fc.record({
        day: fc.integer({ min: 0, max: 6 }),
        field: fc.option(fc.constantFrom("f1", "f2", "f3"), { nil: undefined }),
      }),
      { maxLength: 3 },
    ),
    slotMinutes: fc.constantFrom(45, 60, 75, 90),
  })
  .map(({ windows, blackouts, slotMinutes }) => {
    const base = Date.parse("2026-09-01T00:00:00Z");
    const permits: PermitWindow[] = windows.map((w) => {
      const start = base + w.day * 86_400_000 + w.startMinute * 60_000;
      return {
        fieldId: w.field,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + w.lengthMinutes * 60_000).toISOString(),
      };
    });
    const offs: Blackout[] = blackouts.map((b) => {
      const date = localDate(
        new Date(base + b.day * 86_400_000 + 12 * 3_600_000),
        "America/New_York",
      );
      return b.field ? { date, fieldId: b.field } : { date };
    });
    return { permits, offs, slotMinutes };
  });

describe("generateSlots properties", () => {
  it(
    "P14: every slot is inside a permit, outside every blackout, and overlaps nothing on its field",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(scenario, ({ permits, offs, slotMinutes }) => {
          const slots = generateSlots(permits, offs, {
            slotMinutes,
            timeZone: "America/New_York",
          });
          for (const slot of slots) {
            const [start, end] = [
              Date.parse(slot.startsAt),
              Date.parse(slot.endsAt),
            ];
            expect(end - start).toBe(slotMinutes * 60_000);
            expect(
              permits.some(
                (p) =>
                  p.fieldId === slot.fieldId &&
                  Date.parse(p.startsAt) <= start &&
                  end <= Date.parse(p.endsAt),
              ),
            ).toBe(true);
            expect(
              offs.some(
                (b) =>
                  b.date === slot.date &&
                  (b.fieldId ?? slot.fieldId) === slot.fieldId,
              ),
            ).toBe(false);
            for (const other of slots) {
              if (other === slot || other.fieldId !== slot.fieldId) continue;
              expect(
                Date.parse(other.startsAt) < end &&
                  start < Date.parse(other.endsAt),
              ).toBe(false);
            }
          }
        }),
        { numRuns: 1000 },
      );
    },
  );

  it("time indexes run 0, 1, 2 … in clock order on every date", () => {
    fc.assert(
      fc.property(scenario, ({ permits, offs, slotMinutes }) => {
        const slots = generateSlots(permits, offs, {
          slotMinutes,
          timeZone: "America/New_York",
        });
        const byDate = Map.groupBy(slots, (s) => s.date);
        for (const day of byDate.values()) {
          const starts = [...new Set(day.map((s) => s.startsAt))].sort();
          for (const slot of day)
            expect(slot.timeIndex).toBe(starts.indexOf(slot.startsAt));
        }
      }),
      { numRuns: 1000 },
    );
  });
});
