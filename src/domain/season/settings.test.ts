import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { slugify } from "../slug";
import {
  EMPTY_SEASON_FORM,
  parseSeasonForm,
  type SeasonForm,
  toSeasonForm,
} from "./settings";

const NY = "America/New_York";

const spring: SeasonForm = {
  ...EMPTY_SEASON_FORM,
  name: "Spring 2027",
  startsOn: "2027-04-05",
  endsOn: "2027-06-28",
  playerFee: "85",
  freeAgentFee: "$85.50",
  earlyBirdEndsOn: "2027-03-01",
  earlyBirdDiscount: "10",
  registrationOpensOn: "2027-02-01",
  registrationClosesOn: "2027-03-22",
  paymentDeadlineOn: "2027-03-29",
  maxTeams: "16",
};

const errorsOf = (form: Partial<SeasonForm>) => {
  const result = parseSeasonForm({ ...spring, ...form }, NY);
  return result.ok ? {} : result.errors;
};

describe("parseSeasonForm", () => {
  it("turns dollars into cents and local days into instants", () => {
    const result = parseSeasonForm(spring, NY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      name: "Spring 2027",
      slug: "spring-2027",
      feeModel: "per_player",
      playerFeeCents: 8500,
      freeAgentFeeCents: 8550,
      teamFeeCents: null,
      earlyBirdDiscountCents: 1000,
      maxTeams: 16,
      rosterMin: 12,
      rosterMax: 20,
      gamesPerTeamPerDay: 1,
    });
    // Opens at local midnight (EST); closes at the end of its local day (EDT).
    expect(result.value.registrationOpensAt?.toISOString()).toBe(
      "2027-02-01T05:00:00.000Z",
    );
    expect(result.value.registrationClosesAt?.toISOString()).toBe(
      "2027-03-23T03:59:59.999Z",
    );
  });

  it("leaves optional fields empty", () => {
    const result = parseSeasonForm(
      {
        ...EMPTY_SEASON_FORM,
        name: "Summer",
        startsOn: "2027-06-06",
        endsOn: "2027-08-29",
        feeModel: "per_team",
        teamFee: "1200",
        gamesPerTeamPerDay: "2",
      },
      NY,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        teamFeeCents: 120000,
        playerFeeCents: null,
        earlyBirdEndsAt: null,
        registrationOpensAt: null,
        maxTeams: null,
        gamesPerTeamPerDay: 2,
      },
    });
  });

  it("names each field that is wrong", () => {
    expect(errorsOf({ name: "!!" })).toHaveProperty("name");
    expect(errorsOf({ name: "New" })).toHaveProperty("name");
    expect(errorsOf({ startsOn: "2027-02-30" })).toHaveProperty("startsOn");
    expect(errorsOf({ endsOn: "2027-04-01" })).toEqual({
      endsOn: "The season must end on or after its first day.",
    });
    expect(errorsOf({ feeModel: "free" })).toHaveProperty("feeModel");
    expect(errorsOf({ playerFee: "" })).toHaveProperty("playerFee");
    expect(errorsOf({ feeModel: "per_team" })).toHaveProperty("teamFee");
    expect(errorsOf({ freeAgentFee: "85.555" })).toHaveProperty("freeAgentFee");
    expect(errorsOf({ earlyBirdEndsOn: "" })).toHaveProperty(
      "earlyBirdDiscount",
    );
    expect(errorsOf({ earlyBirdDiscount: "85" })).toEqual({
      earlyBirdDiscount: "The discount must be less than the fee.",
    });
    expect(errorsOf({ paymentDeadlineOn: "soon" })).toHaveProperty(
      "paymentDeadlineOn",
    );
    expect(errorsOf({ registrationClosesOn: "2027-01-15" })).toHaveProperty(
      "registrationClosesOn",
    );
    expect(errorsOf({ paymentDeadlineOn: "2027-01-15" })).toHaveProperty(
      "paymentDeadlineOn",
    );
    expect(errorsOf({ maxTeams: "1" })).toHaveProperty("maxTeams");
    expect(errorsOf({ rosterMin: "0" })).toHaveProperty("rosterMin");
    expect(errorsOf({ rosterMax: "" })).toHaveProperty("rosterMax");
    expect(errorsOf({ rosterMax: "10" })).toEqual({
      rosterMax: "At least the minimum roster.",
    });
    expect(errorsOf({ gamesPerTeamPerDay: "3" })).toHaveProperty(
      "gamesPerTeamPerDay",
    );
  });

  it("round-trips through the edit form", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500_000 }),
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 0, max: 300 }),
        (fee, discount, offset) => {
          const day = new Date(Date.UTC(2027, 0, 1) + offset * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const form: SeasonForm = {
            ...spring,
            playerFee: (fee / 100).toFixed(2),
            earlyBirdDiscount: (discount / 100).toFixed(2),
            earlyBirdEndsOn: day,
            registrationOpensOn: day,
            registrationClosesOn: day,
            paymentDeadlineOn: day,
          };
          const parsed = parseSeasonForm(form, NY);
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) return;
          const again = parseSeasonForm(toSeasonForm(parsed.value, NY), NY);
          expect(again).toEqual(parsed);
        },
      ),
    );
  });
});

describe("toSeasonForm", () => {
  it("shows whole dollars without cents and blanks for nulls", () => {
    const parsed = parseSeasonForm(
      { ...spring, earlyBirdEndsOn: "", earlyBirdDiscount: "", maxTeams: "" },
      NY,
    );
    if (!parsed.ok) throw new Error();
    expect(toSeasonForm(parsed.value, NY)).toMatchObject({
      playerFee: "85",
      freeAgentFee: "85.50",
      teamFee: "",
      earlyBirdEndsOn: "",
      maxTeams: "",
      registrationClosesOn: "2027-03-22",
    });
  });
});

describe("slugify", () => {
  it("makes a URL-safe slug", () => {
    expect(slugify("  McCarren Park — Field Ñ 2 ")).toBe(
      "mccarren-park-field-n-2",
    );
    expect(slugify("!!!")).toBe("");
  });
});
