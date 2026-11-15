import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  draftLeague,
  draftLeagueName,
  firstGameDay,
  freeSlug,
  LEAD_WEEKS,
} from "./draft-league";
import { isLeagueSlug } from "./paths";

const source = {
  timeZone: "America/New_York",
  minimumAge: 21,
  primaryColor: "#1F3A8A",
  secondaryColor: "#F5B301",
};

const base = {
  choice: { night: "thursday", format: "social", park: "McCarren Park" },
  sport: "kickball",
  source,
  template: null,
  teamsNeeded: 8,
  playersPerTeam: 12,
  takenSlugs: new Set<string>(),
  today: "2026-11-15",
} as const;

describe("draftLeague", () => {
  it("names the league from the option and copies the asking league", () => {
    const { league, season } = draftLeague(base);
    expect(league).toEqual({
      name: "Thursday Social Kickball at McCarren Park",
      slug: "thursday-social-kickball-at-mccarren-par",
      sport: "kickball",
      ...source,
      ruleSet: { name: "Standard", innings: null, timeLimitMinutes: null },
    });
    expect(season).toEqual({
      name: "First season",
      slug: "first-season",
      status: "draft",
      // The first Thursday six weeks or more from Sunday, Nov 15.
      startsOn: "2026-12-31",
      endsOn: "2027-02-18",
      maxTeams: 8,
      feeModel: "per_player",
      teamFeeCents: null,
      playerFeeCents: 0,
      freeAgentFeeCents: null,
      rosterMin: 10,
      rosterMax: 20,
    });
  });

  it("gives a sport played in sets its default match length", () => {
    const { league } = draftLeague({
      ...base,
      sport: "dodgeball",
      choice: { night: "tuesday", format: null, park: null },
    });
    expect(league.name).toBe("Tuesday Dodgeball");
    expect(league.ruleSet.bestOf).toBe(5);
  });

  it("starts from the asking league's latest fees and roster limits", () => {
    const template = {
      feeModel: "per_team" as const,
      teamFeeCents: 90000,
      playerFeeCents: null,
      freeAgentFeeCents: 7000,
      rosterMin: 14,
      rosterMax: 24,
    };
    expect(draftLeague({ ...base, template }).season).toMatchObject(template);
  });
});

describe("names and addresses", () => {
  it("leaves out what the option didn't name", () => {
    expect(
      draftLeagueName(
        { night: null, format: null, park: "Prospect Park" },
        "kickball",
      ),
    ).toBe("Kickball at Prospect Park");
  });

  it("finds an address no league has", () => {
    expect(freeSlug("Tuesday Kickball", new Set())).toBe("tuesday-kickball");
    expect(
      freeSlug(
        "Tuesday Kickball",
        new Set(["tuesday-kickball", "tuesday-kickball-2"]),
      ),
    ).toBe("tuesday-kickball-3");
    expect(freeSlug("!!!", new Set())).toBe("new-league");
  });

  it("always makes a valid, free address", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 120 }),
        fc.array(fc.string({ maxLength: 40 })),
        (name, taken) => {
          const takenSet = new Set(taken);
          const slug = freeSlug(name, takenSet);
          expect(isLeagueSlug(slug)).toBe(true);
          expect(takenSet.has(slug)).toBe(false);
        },
      ),
    );
  });
});

describe("firstGameDay", () => {
  it("is the option's night, at least the lead time away", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2026-01-01T00:00:00Z"),
          max: new Date("2030-12-31T00:00:00Z"),
          noInvalidDate: true,
        }),
        fc.constantFrom(
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ),
        (date, night) => {
          const today = date.toISOString().slice(0, 10);
          const first = firstGameDay(today, night);
          const days =
            (Date.parse(`${first}T00:00:00Z`) -
              Date.parse(`${today}T00:00:00Z`)) /
            86_400_000;
          expect(days).toBeGreaterThanOrEqual(LEAD_WEEKS * 7);
          expect(days).toBeLessThan(LEAD_WEEKS * 7 + 7);
          expect(
            new Date(`${first}T12:00:00Z`)
              .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
              .toLowerCase(),
          ).toBe(night);
        },
      ),
    );
  });
});
