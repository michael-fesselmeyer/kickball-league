import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ageConfirmationLabel,
  ageMessage,
  checkAge,
  DEFAULT_MINIMUM_AGE,
  minimumAgeFor,
  parseMinimumAge,
  underAge,
} from "./age";

const TODAY = "2026-11-14";

describe("the minimum age", () => {
  it("is the season's own, else the league's", () => {
    expect(minimumAgeFor({ minimumAge: 21 }, { minimumAge: null })).toBe(21);
    expect(minimumAgeFor({ minimumAge: 21 }, { minimumAge: 25 })).toBe(25);
    expect(DEFAULT_MINIMUM_AGE).toBe(21);
  });

  it("reads the season form: blank for the league's, else 18 to 99", () => {
    expect(parseMinimumAge(" ")).toEqual({ ok: true, value: null });
    expect(parseMinimumAge("21")).toEqual({ ok: true, value: 21 });
    for (const bad of ["17", "100", "twenty", "21.5", "-21"])
      expect(parseMinimumAge(bad).ok).toBe(false);
  });
});

describe("the age check", () => {
  const check = (over: Partial<Parameters<typeof checkAge>[0]>) =>
    checkAge({
      confirmed: true,
      minimumAge: 21,
      birthDate: "1994-05-17",
      today: TODAY,
      ...over,
    });

  it("lets a player of age go on once they confirm", () => {
    expect(check({})).toEqual({ ok: true, value: { minimumAge: 21 } });
    expect(check({ confirmed: false })).toEqual({
      ok: false,
      error: "age_unconfirmed",
    });
  });

  it("checks the confirmation against the birth date on file", () => {
    // Turns 21 tomorrow: not yet.
    expect(check({ birthDate: "2005-11-15" })).toEqual({
      ok: false,
      error: "under_age",
    });
    // Turns 21 today.
    expect(check({ birthDate: "2005-11-14" }).ok).toBe(true);
    // Ticking the box doesn't get round the birth date.
    expect(check({ birthDate: "2007-01-01", confirmed: true }).ok).toBe(false);
  });

  it("relies on the confirmation when no birth date is on file", () => {
    expect(check({ birthDate: null }).ok).toBe(true);
    expect(check({ birthDate: null, confirmed: false }).ok).toBe(false);
  });

  it("never lets in anyone the birth date says is too young", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 18, max: 99 }),
        fc.date({
          min: new Date("1920-01-01T00:00:00Z"),
          max: new Date("2026-11-14T00:00:00Z"),
          noInvalidDate: true,
        }),
        (minimumAge, born) => {
          const birthDate = born.toISOString().slice(0, 10);
          const result = checkAge({
            confirmed: true,
            minimumAge,
            birthDate,
            today: TODAY,
          });
          expect(result.ok).toBe(!underAge(minimumAge, birthDate, TODAY));
        },
      ),
    );
  });

  it("speaks plainly", () => {
    expect(ageConfirmationLabel(21)).toBe("I'm 21 or older");
    expect(ageMessage("under_age", 21)).toContain("must be 21 or older");
    expect(ageMessage("age_unconfirmed", 25)).toBe(
      "Confirm you're 25 or older to go on.",
    );
  });
});
