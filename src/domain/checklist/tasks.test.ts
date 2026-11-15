import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  dueLabel,
  dueOnFor,
  offsetLabel,
  parseTaskForm,
  parseTemplateForm,
  reminderFor,
  STARTER_TEMPLATE,
  TITLE_MAX,
} from "./tasks";

const ADMIN = "0b4c7c43-3e7a-4d55-9d43-1f1d5c3b8a01";
const STAFF = new Set([ADMIN]);

describe("STARTER_TEMPLATE", () => {
  it("has the season's usual jobs, in date order", () => {
    expect(STARTER_TEMPLATE.map((t) => t.title)).toEqual([
      "Renew the field permits",
      "Get the insurance certificate",
      "Open registration",
      "Book the bar for the season party",
      "Order shirts",
      "Line up refs",
      "Send the schedule",
      "Send the end-of-season survey",
    ]);
    const offsets = STARTER_TEMPLATE.map((t) => t.offsetDays);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("dates each task from the season's first day", () => {
    expect(dueOnFor("2027-04-10", -7)).toBe("2027-04-03");
    expect(dueOnFor("2027-04-10", 63)).toBe("2027-06-12");
    // Across the clocks changing, a day is still a day.
    expect(dueOnFor("2026-11-02", -1)).toBe("2026-11-01");
  });
});

describe("parseTaskForm", () => {
  const base = {
    title: " Order shirts ",
    notes: " Sizes from the roster ",
    dueOn: "2027-03-20",
    owner: ADMIN,
  };

  it("trims the words and keeps an owner from the staff", () => {
    expect(parseTaskForm(base, STAFF)).toEqual({
      ok: true,
      value: {
        title: "Order shirts",
        notes: "Sizes from the roster",
        dueOn: "2027-03-20",
        ownerId: ADMIN,
      },
    });
    expect(parseTaskForm({ ...base, owner: "" }, STAFF)).toMatchObject({
      ok: true,
      value: { ownerId: null },
    });
  });

  it("refuses an empty or long title, a bad date and a stranger", () => {
    const error = (over: Partial<typeof base>) =>
      parseTaskForm({ ...base, ...over }, STAFF);
    expect(error({ title: "  " })).toEqual({ ok: false, error: "empty_title" });
    expect(error({ title: "x".repeat(TITLE_MAX + 1) })).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(error({ dueOn: "soon" })).toEqual({ ok: false, error: "bad_date" });
    expect(error({ owner: "8c1f1d0e-0d6b-4c8e-9b3a-2f7a1e5c9d10" })).toEqual({
      ok: false,
      error: "bad_owner",
    });
    expect(error({ owner: "not-an-id" })).toEqual({
      ok: false,
      error: "bad_owner",
    });
  });
});

describe("parseTemplateForm", () => {
  const base = {
    title: "Line up refs",
    notes: "",
    offsetDays: "-14",
    owner: "",
  };

  it("reads whole days before or after the start", () => {
    expect(parseTemplateForm(base, STAFF)).toMatchObject({
      ok: true,
      value: { offsetDays: -14, ownerId: null },
    });
    expect(
      parseTemplateForm({ ...base, offsetDays: "30" }, STAFF),
    ).toMatchObject({ ok: true, value: { offsetDays: 30 } });
  });

  it("refuses fractions, words and offsets past a year", () => {
    for (const offsetDays of ["1.5", "two", "", "366", "-400"])
      expect(parseTemplateForm({ ...base, offsetDays }, STAFF)).toEqual({
        ok: false,
        error: "bad_offset",
      });
  });
});

describe("reminderFor", () => {
  it("reminds in the last three days and once overdue", () => {
    const today = "2027-03-10";
    expect(reminderFor("2027-03-14", today)).toBeNull();
    expect(reminderFor("2027-03-13", today)).toBe("soon");
    expect(reminderFor("2027-03-10", today)).toBe("soon");
    expect(reminderFor("2027-03-09", today)).toBe("overdue");
    expect(reminderFor("2027-02-08", today)).toBe("overdue");
    expect(reminderFor("2027-02-07", today)).toBeNull();
  });

  it("never sends both on one day", () => {
    fc.assert(
      fc.property(fc.integer({ min: -400, max: 400 }), (days) => {
        const kind = reminderFor(dueOnFor("2027-03-10", days), "2027-03-10");
        if (days > 3 || days < -30) expect(kind).toBeNull();
        else expect(kind).toBe(days >= 0 ? "soon" : "overdue");
      }),
    );
  });
});

describe("labels", () => {
  it("say how far off a task is", () => {
    expect(dueLabel("2027-03-10", "2027-03-10")).toBe("Due today");
    expect(dueLabel("2027-03-11", "2027-03-10")).toBe("Due tomorrow");
    expect(dueLabel("2027-03-15", "2027-03-10")).toBe("Due in 5 days");
    expect(dueLabel("2027-03-09", "2027-03-10")).toBe("1 day overdue");
    expect(dueLabel("2027-03-01", "2027-03-10")).toBe("9 days overdue");
  });

  it("say where a template task falls", () => {
    expect(offsetLabel(-14)).toBe("14 days before the start");
    expect(offsetLabel(1)).toBe("1 day after the start");
    expect(offsetLabel(0)).toBe("On the first day");
  });
});
