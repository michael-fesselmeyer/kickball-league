import { describe, expect, it } from "vitest";
import type { Pattern } from "@/domain/permits/renewal";
import { wantedFrom } from "./choices";

const patterns: Pattern[] = [
  {
    key: "f2/0/12:00/18:00",
    fieldId: "f2",
    place: "McCarren Park, Field 2",
    weekday: 0,
    start: "12:00",
    end: "18:00",
    dates: ["2026-09-13"],
  },
  {
    key: "f1/1/18:00/21:00",
    fieldId: "f1",
    place: "McCarren Park, Field 1",
    weekday: 1,
    start: "18:00",
    end: "21:00",
    dates: ["2026-09-14"],
  },
];
const fields = [
  { id: "f1", place: "McCarren Park, Field 1" },
  { id: "f3", place: "McCarren Park, Field 3" },
];

describe("wantedFrom", () => {
  it("renews everything unchanged until the owner changes something", () => {
    const { wanted, changed, added } = wantedFrom({}, patterns, fields);
    expect(changed).toBe(false);
    expect(added).toBeNull();
    expect(wanted.map((w) => [w.of, w.start, w.end])).toEqual([
      ["f2/0/12:00/18:00", "12:00", "18:00"],
      ["f1/1/18:00/21:00", "18:00", "21:00"],
    ]);
  });

  it("reads kept rows, new hours, a dropped row and an added field", () => {
    const { wanted, added } = wantedFrom(
      {
        set: "1",
        k0: "on",
        s0: "10:00",
        e0: "20:00",
        s1: "18:00",
        e1: "21:00",
        af: "f3",
        aw: "6",
        as: "09:00",
        ae: "13:00",
      },
      patterns,
      fields,
    );
    expect(wanted).toEqual([
      {
        of: "f2/0/12:00/18:00",
        fieldId: "f2",
        place: "McCarren Park, Field 2",
        weekday: 0,
        start: "10:00",
        end: "20:00",
      },
      {
        of: null,
        fieldId: "f3",
        place: "McCarren Park, Field 3",
        weekday: 6,
        start: "09:00",
        end: "13:00",
      },
    ]);
    expect(added).toEqual({
      fieldId: "f3",
      weekday: 6,
      start: "09:00",
      end: "13:00",
    });
  });

  it("falls back to the held hours for a bad time, and ignores a bad addition", () => {
    const { wanted, added } = wantedFrom(
      {
        set: "1",
        k0: "on",
        s0: "25:00",
        e0: "nope",
        af: "unknown",
        aw: "6",
        as: "09:00",
        ae: "13:00",
      },
      patterns,
      fields,
    );
    expect(wanted.map((w) => [w.start, w.end])).toEqual([["12:00", "18:00"]]);
    expect(added).toBeNull();
    const backwards = wantedFrom(
      { set: "1", af: "f3", aw: "6", as: "13:00", ae: "09:00" },
      patterns,
      fields,
    );
    expect(backwards.added).toBeNull();
    expect(backwards.wanted).toEqual([]);
  });
});
