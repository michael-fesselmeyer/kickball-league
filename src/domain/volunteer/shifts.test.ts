import { describe, expect, it } from "vitest";
import {
  mayClaim,
  mayDrop,
  occasionValue,
  parseOccasion,
  parseShiftForm,
  type ShiftForm,
  shiftFormValues,
  spotsLeft,
  spotsLine,
} from "./shifts";

const NY = "America/New_York";
const SEASON = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";

const form = (over: Partial<ShiftForm> = {}): ShiftForm => ({
  role: "setup",
  occasion: `season:${SEASON}`,
  on: "2026-10-20",
  starts: "18:00",
  ends: "18:45",
  place: "  Field 2  ",
  notes: " Bring cones. ",
  spots: "3",
  ...over,
});

describe("parseShiftForm", () => {
  it("reads a game-day shift in the league's time zone", () => {
    const parsed = parseShiftForm(form(), NY);
    expect(parsed).toEqual({
      ok: true,
      value: {
        role: "setup",
        occasion: { kind: "season", seasonId: SEASON },
        // 18:00 EDT is 22:00 UTC.
        startsAt: new Date("2026-10-20T22:00:00Z"),
        endsAt: new Date("2026-10-20T22:45:00Z"),
        place: "Field 2",
        notes: "Bring cones.",
        spots: 3,
      },
    });
  });

  it("reads an event shift and leaves an empty place out", () => {
    const parsed = parseShiftForm(
      form({ occasion: `event:${EVENT}`, place: " ", role: "check_in" }),
      NY,
    );
    expect(parsed.ok && parsed.value.occasion).toEqual({
      kind: "event",
      eventId: EVENT,
    });
    expect(parsed.ok && parsed.value.place).toBeNull();
  });

  it("runs a late teardown past midnight", () => {
    const parsed = parseShiftForm(
      form({ role: "teardown", starts: "23:30", ends: "00:30" }),
      NY,
    );
    expect(parsed.ok && parsed.value.endsAt).toEqual(
      new Date("2026-10-21T04:30:00Z"),
    );
  });

  it.each([
    [{ role: "bouncer" }, "role"],
    [{ occasion: "" }, "occasion"],
    [{ occasion: "team:abc" }, "occasion"],
    [{ occasion: `party:${SEASON}` }, "occasion"],
    [{ on: "2026-02-30" }, "date"],
    [{ starts: "6pm" }, "time"],
    [{ starts: "19:00", ends: "18:00" }, "order"],
    [{ spots: "0" }, "spots"],
    [{ spots: "51" }, "spots"],
    [{ spots: "2.5" }, "spots"],
    [{ spots: "" }, "spots"],
    [{ place: "x".repeat(121) }, "place"],
    [{ notes: "x".repeat(501) }, "notes"],
  ] as const)("refuses %o with %s", (over, error) => {
    expect(parseShiftForm(form(over), NY)).toEqual({ ok: false, error });
  });

  it("round-trips through the edit form", () => {
    const parsed = parseShiftForm(form(), NY);
    if (!parsed.ok) throw new Error("expected a shift");
    expect(shiftFormValues(parsed.value, NY)).toEqual(
      form({ place: "Field 2", notes: "Bring cones." }),
    );
  });
});

describe("occasions", () => {
  it("writes and reads the picker's value", () => {
    const o = { kind: "event" as const, eventId: EVENT };
    expect(parseOccasion(occasionValue(o))).toEqual(o);
    expect(parseOccasion(`season:${SEASON.toUpperCase()}`)).toEqual({
      kind: "season",
      seasonId: SEASON,
    });
  });
});

describe("mayClaim", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const startsAt = new Date("2026-10-20T22:00:00Z");
  const base = { startsAt, spots: 2, taken: 1, alreadyOn: false, now };

  it("lets a member take an open spot", () => {
    expect(mayClaim(base).ok).toBe(true);
  });

  it("refuses a full shift, a second spot and a shift under way", () => {
    expect(mayClaim({ ...base, taken: 2 })).toEqual({
      ok: false,
      error: "full",
    });
    expect(mayClaim({ ...base, taken: 3 })).toEqual({
      ok: false,
      error: "full",
    });
    expect(mayClaim({ ...base, alreadyOn: true })).toEqual({
      ok: false,
      error: "already",
    });
    expect(mayClaim({ ...base, now: startsAt })).toEqual({
      ok: false,
      error: "started",
    });
  });
});

describe("mayDrop", () => {
  it("allows dropping until the start", () => {
    const startsAt = new Date("2026-10-20T22:00:00Z");
    expect(
      mayDrop({ startsAt, now: new Date(startsAt.getTime() - 1) }).ok,
    ).toBe(true);
    expect(mayDrop({ startsAt, now: startsAt })).toEqual({
      ok: false,
      error: "started",
    });
  });
});

describe("spots", () => {
  it("counts what's left, never below zero", () => {
    expect(spotsLeft(4, 1)).toBe(3);
    expect(spotsLeft(2, 3)).toBe(0);
  });

  it("writes the spots line", () => {
    expect(spotsLine(4, 2)).toBe("2 of 4 spots left");
    expect(spotsLine(1, 0)).toBe("1 of 1 spot left");
    expect(spotsLine(2, 2)).toBe("Full");
  });
});
