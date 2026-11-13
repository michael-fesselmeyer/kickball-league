import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  confirmedLabel,
  dealApplies,
  dealOnDay,
  dealWhen,
  isoWeekday,
  parseDealForm,
} from "./deals";

// 2026-11-10 is a Tuesday.
const TUESDAY = "2026-11-10";
const WEDNESDAY = "2026-11-11";

const deal = (
  validDays: number[],
  validFrom: string | null = null,
  validTo: string | null = null,
) => ({ validDays, validFrom, validTo });

describe("when a deal applies", () => {
  it("knows the weekday of a date", () => {
    expect(isoWeekday(TUESDAY)).toBe(2);
    expect(isoWeekday("2026-11-15")).toBe(7);
    expect(isoWeekday("2026-11-16")).toBe(1);
  });

  it("applies every day when no day is set", () => {
    expect(dealApplies(deal([]), TUESDAY, "13:00")).toBe(true);
    expect(dealOnDay(deal([]), WEDNESDAY)).toBe(true);
  });

  it("applies only on its days and inside its hours", () => {
    const tuesdayNights = deal([2], "18:00", "22:00");
    expect(dealApplies(tuesdayNights, TUESDAY, "18:00")).toBe(true);
    expect(dealApplies(tuesdayNights, TUESDAY, "21:59")).toBe(true);
    expect(dealApplies(tuesdayNights, TUESDAY, "22:00")).toBe(false);
    expect(dealApplies(tuesdayNights, TUESDAY, "17:59")).toBe(false);
    expect(dealApplies(tuesdayNights, WEDNESDAY, "19:00")).toBe(false);
    expect(dealOnDay(tuesdayNights, WEDNESDAY)).toBe(false);
  });

  it("carries a late window past midnight into the next morning", () => {
    const late = deal([2], "21:00", "02:00");
    expect(dealApplies(late, TUESDAY, "23:30")).toBe(true);
    expect(dealApplies(late, WEDNESDAY, "01:30")).toBe(true);
    expect(dealApplies(late, WEDNESDAY, "02:00")).toBe(false);
    expect(dealApplies(late, WEDNESDAY, "22:00")).toBe(false);
    // Monday's small hours belong to Sunday night.
    expect(dealApplies(deal([7], "21:00", "02:00"), "2026-11-16", "01:00")).toBe(
      true,
    );
  });

  it("never applies on a day it is not offered, at any time", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 7 }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 1439 }),
        (days, minute) => {
          const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
          const off = [1, 2, 3, 4, 5, 6, 7].find((d) => !days.includes(d));
          // 2026-11-09 is a Monday, so day d is 2026-11-(8 + d).
          const day = `2026-11-${String(8 + (off ?? 1)).padStart(2, "0")}`;
          expect(dealApplies(deal(days, "10:00", "20:00"), day, time)).toBe(
            false,
          );
        },
      ),
    );
  });
});

describe("saying when a deal applies", () => {
  it("names the days and hours in plain words", () => {
    expect(dealWhen(deal([]))).toBe("Every day");
    expect(dealWhen(deal([1, 2, 3, 4, 5]))).toBe("Weekdays");
    expect(dealWhen(deal([6, 7]))).toBe("Weekends");
    expect(dealWhen(deal([2]))).toBe("Tuesdays");
    expect(dealWhen(deal([2, 4], "18:00", "22:30"))).toBe(
      "Tuesdays and Thursdays, 6 PM to 10:30 PM",
    );
    expect(dealWhen(deal([1, 3, 5], "12:00:00", "00:00:00"))).toBe(
      "Mondays, Wednesdays and Fridays, noon to midnight",
    );
  });

  it("says when the deals were last confirmed, as a date", () => {
    expect(confirmedLabel(TUESDAY)).toBe("Confirmed Nov 10");
  });
});

describe("the deal form", () => {
  const form = {
    title: "  $2 off any burger ",
    terms: "",
    days: [],
    from: "",
    to: "",
  };

  it("reads a deal with no days or hours as every day, all day", () => {
    expect(parseDealForm(form)).toEqual({
      ok: true,
      value: {
        title: "$2 off any burger",
        terms: null,
        validDays: [],
        validFrom: null,
        validTo: null,
      },
    });
  });

  it("keeps the ticked days in order and stores all seven as every day", () => {
    const some = parseDealForm({ ...form, days: ["4", "2", "2", "9", "x"] });
    expect(some.ok && some.value.validDays).toEqual([2, 4]);
    const all = parseDealForm({
      ...form,
      days: ["1", "2", "3", "4", "5", "6", "7"],
    });
    expect(all.ok && all.value.validDays).toEqual([]);
  });

  it("names what is wrong", () => {
    expect(parseDealForm({ ...form, title: " " })).toEqual({
      ok: false,
      error: "title_missing",
    });
    expect(parseDealForm({ ...form, title: "x".repeat(81) })).toEqual({
      ok: false,
      error: "title_too_long",
    });
    expect(parseDealForm({ ...form, terms: "x".repeat(301) })).toEqual({
      ok: false,
      error: "terms_too_long",
    });
    expect(parseDealForm({ ...form, from: "18:00" })).toEqual({
      ok: false,
      error: "half_time",
    });
    expect(parseDealForm({ ...form, from: "25:00", to: "26:00" })).toEqual({
      ok: false,
      error: "bad_time",
    });
    expect(parseDealForm({ ...form, from: "18:00", to: "18:00" })).toEqual({
      ok: false,
      error: "bad_time",
    });
  });
});
