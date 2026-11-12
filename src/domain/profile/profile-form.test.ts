import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatPhone,
  isAtLeast,
  normalizePhone,
  parseProfileForm,
  type ProfileForm,
  toProfileForm,
} from "./profile-form";

const TODAY = "2026-11-12";

const form: ProfileForm = {
  firstName: " Robin ",
  lastName: "Example",
  phone: "(718) 555-0123",
  gender: "woman",
  lineupGender: "",
  shirtSize: "m",
  birthDate: "1995-06-15",
  emergencyContactName: "Sam Example",
  emergencyContactPhone: "+44 20 7946 0958",
};

const errorsOf = (change: Partial<ProfileForm>) => {
  const result = parseProfileForm({ ...form, ...change }, TODAY);
  return result.ok ? {} : result.errors;
};

describe("normalizePhone", () => {
  it("reads US numbers and international numbers with +", () => {
    expect(normalizePhone("(718) 555-0123")).toBe("+17185550123");
    expect(normalizePhone("1-718-555-0123")).toBe("+17185550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("refuses what cannot be a number", () => {
    for (const bad of ["", "555-0123", "call me", "+0123456789", "0718555012"])
      expect(normalizePhone(bad)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats US numbers and leaves others in E.164", () => {
    expect(formatPhone("+17185550123")).toBe("(718) 555-0123");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
  });

  it("round-trips any US number", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 999 }),
        fc.integer({ min: 200, max: 999 }),
        fc.integer({ min: 0, max: 9999 }),
        (area, exchange, line) => {
          const e164 = `+1${area}${exchange}${String(line).padStart(4, "0")}`;
          expect(normalizePhone(formatPhone(e164))).toBe(e164);
        },
      ),
    );
  });
});

describe("isAtLeast", () => {
  it("counts the birthday itself", () => {
    expect(isAtLeast(18, "2008-11-12", TODAY)).toBe(true);
    expect(isAtLeast(18, "2008-11-13", TODAY)).toBe(false);
  });

  it("counts a February 29 birthday on March 1 in other years", () => {
    expect(isAtLeast(18, "2008-02-29", "2026-02-28")).toBe(false);
    expect(isAtLeast(18, "2008-02-29", "2026-03-01")).toBe(true);
    expect(isAtLeast(16, "2008-02-29", "2024-02-29")).toBe(true);
  });
});

describe("parseProfileForm", () => {
  it("normalizes a complete profile", () => {
    expect(parseProfileForm(form, TODAY)).toEqual({
      ok: true,
      value: {
        firstName: "Robin",
        lastName: "Example",
        phoneE164: "+17185550123",
        gender: "woman",
        lineupGender: "woman",
        shirtSize: "m",
        birthDate: "1995-06-15",
        emergencyContactName: "Sam Example",
        emergencyContactPhone: "+442079460958",
      },
    });
  });

  it("asks players outside the two groups which one the fielding rule counts", () => {
    expect(errorsOf({ gender: "nonbinary" })).toHaveProperty("lineupGender");
    expect(
      parseProfileForm(
        { ...form, gender: "nonbinary", lineupGender: "man" },
        TODAY,
      ),
    ).toMatchObject({
      ok: true,
      value: { gender: "nonbinary", lineupGender: "man" },
    });
    // Woman or man sets the group, whatever the second field says.
    expect(
      parseProfileForm(
        { ...form, gender: "man", lineupGender: "woman" },
        TODAY,
      ),
    ).toMatchObject({ ok: true, value: { lineupGender: "man" } });
  });

  it("refuses players under 18", () => {
    expect(errorsOf({ birthDate: "2008-11-13" })).toEqual({
      birthDate: "Players must be 18 or older.",
    });
    expect(errorsOf({ birthDate: "2008-11-12" })).toEqual({});
  });

  it("names each field that is wrong", () => {
    expect(errorsOf({ firstName: "" })).toHaveProperty("firstName");
    expect(errorsOf({ lastName: "x".repeat(61) })).toHaveProperty("lastName");
    expect(errorsOf({ phone: "nope" })).toHaveProperty("phone");
    expect(errorsOf({ gender: "other" })).toEqual({
      gender: "Choose an option.",
    });
    expect(errorsOf({ shirtSize: "xxxl" })).toHaveProperty("shirtSize");
    expect(errorsOf({ birthDate: "1995-02-30" })).toHaveProperty("birthDate");
    expect(errorsOf({ birthDate: "2030-01-01" })).toHaveProperty("birthDate");
    expect(errorsOf({ emergencyContactName: "" })).toHaveProperty(
      "emergencyContactName",
    );
    expect(errorsOf({ emergencyContactPhone: "" })).toHaveProperty(
      "emergencyContactPhone",
    );
    expect(errorsOf({ emergencyContactPhone: "718.555.0123" })).toEqual({
      emergencyContactPhone:
        "Use someone else's number, so we can reach them if you are hurt.",
    });
  });
});

describe("toProfileForm", () => {
  it("fills the form from a stored profile, blank where empty", () => {
    const parsed = parseProfileForm(form, TODAY);
    if (!parsed.ok) throw new Error();
    expect(parseProfileForm(toProfileForm(parsed.value), TODAY)).toEqual(
      parsed,
    );
    expect(
      toProfileForm({
        firstName: null,
        lastName: null,
        phoneE164: null,
        gender: null,
        lineupGender: null,
        shirtSize: null,
        birthDate: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      }),
    ).toEqual({
      firstName: "",
      lastName: "",
      phone: "",
      gender: "",
      lineupGender: "",
      shirtSize: "",
      birthDate: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
    });
  });
});
