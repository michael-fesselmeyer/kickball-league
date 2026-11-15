import { describe, expect, it } from "vitest";
import type { ParkField } from "../capacity/nearby";
import { nextYear, periodDates, periodOf } from "./calendar";
import { boroughAt, byBorough, packetText, type PacketInput } from "./packet";
import {
  draftDates,
  heldWindows,
  patternsOf,
  renewalTarget,
  splitRenewal,
  type Pattern,
  type Wanted,
} from "./renewal";

const TZ = "America/New_York";

describe("NYC Parks' calendar", () => {
  it("has each period's renewal, new-request and first-come dates", () => {
    expect(periodDates("spring_summer", 2027)).toEqual({
      period: "spring_summer",
      year: 2027,
      plays: { from: "2027-04-01", to: "2027-08-31" },
      renewals: { from: "2026-11-15", to: "2026-12-14" },
      newRequests: { from: "2026-12-30", to: "2027-01-30" },
      firstCome: { from: "2027-03-17", to: "2027-08-23" },
    });
    expect(periodDates("fall", 2027).renewals).toEqual({
      from: "2027-04-15",
      to: "2027-05-14",
    });
    expect(periodDates("winter", 2026)).toMatchObject({
      plays: { from: "2026-12-01", to: "2027-03-31" },
      renewals: { from: "2026-09-15", to: "2026-10-14" },
      newRequests: { from: "2026-10-21", to: "2026-11-08" },
      firstCome: { from: "2026-11-18", to: "2027-03-23" },
    });
  });

  it.each([
    ["2026-04-01", "spring_summer", 2026],
    ["2026-08-31", "spring_summer", 2026],
    ["2026-09-01", "fall", 2026],
    ["2026-11-30", "fall", 2026],
    ["2026-12-01", "winter", 2026],
    ["2027-01-15", "winter", 2026],
    ["2027-03-31", "winter", 2026],
  ])("puts %s in %s %i", (on, period, year) => {
    expect(periodOf(on)).toMatchObject({ period, year });
  });

  it("renews into the same period a year on", () => {
    expect(nextYear(periodOf("2026-09-16")).renewals.from).toBe("2027-04-15");
    expect(nextYear(periodOf("2027-01-10")).plays.from).toBe("2027-12-01");
  });
});

const sunday = (on: string, start = "16:00", end = "22:00") => ({
  fieldId: "f2",
  place: "McCarren Park, Field 2",
  startsAt: new Date(`${on}T${start}:00Z`),
  endsAt: new Date(`${on}T${end}:00Z`),
});

describe("patternsOf", () => {
  it("groups the season's windows by field, weekday and local hours", () => {
    const patterns = patternsOf(
      [
        sunday("2026-09-13"),
        sunday("2026-09-20"),
        sunday("2026-09-27", "18:00", "22:00"),
        {
          ...sunday("2026-09-14"),
          fieldId: "f1",
          place: "McCarren Park, Field 1",
        },
      ],
      TZ,
    );
    expect(
      patterns.map((p) => [p.place, p.weekday, p.start, p.end, p.dates]),
    ).toEqual([
      [
        "McCarren Park, Field 2",
        0,
        "12:00",
        "18:00",
        ["2026-09-13", "2026-09-20"],
      ],
      ["McCarren Park, Field 2", 0, "14:00", "18:00", ["2026-09-27"]],
      ["McCarren Park, Field 1", 1, "12:00", "18:00", ["2026-09-14"]],
    ]);
  });

  it("skips a window past midnight", () => {
    expect(patternsOf([sunday("2026-09-13", "23:00", "05:00")], TZ)).toEqual(
      [],
    );
  });
});

const held: Pattern[] = [
  {
    key: "f2/0/12:00/18:00",
    fieldId: "f2",
    place: "McCarren Park, Field 2",
    weekday: 0,
    start: "12:00",
    end: "18:00",
    dates: ["2026-09-13", "2026-09-20"],
  },
];
const target = nextYear(periodOf("2026-09-13"));
const same: Wanted = {
  of: "f2/0/12:00/18:00",
  fieldId: "f2",
  place: "McCarren Park, Field 2",
  weekday: 0,
  start: "12:00",
  end: "18:00",
};

describe("draftDates", () => {
  it("moves each date 52 weeks on, keeping the weekday and the period", () => {
    expect(draftDates(["2026-09-13", "2026-09-20"], target)).toEqual([
      "2027-09-12",
      "2027-09-19",
    ]);
  });

  it("moves a date at the period's edge a week, so it stays in the period", () => {
    // September 1, 2026 is a Tuesday; 52 weeks on is August 31, 2027.
    expect(draftDates(["2026-09-01"], target)).toEqual(["2027-09-07"]);
    const spring = nextYear(periodOf("2027-04-01"));
    expect(draftDates(["2027-04-01"], spring)).toEqual(["2028-04-06"]);
  });

  it("leaves out dates that weren't in last year's period", () => {
    expect(draftDates(["2026-08-30", "2026-09-06"], target)).toEqual([
      "2027-09-05",
    ]);
  });

  it("finds the target from the season's first date", () => {
    expect(renewalTarget(held)).toMatchObject({ period: "fall", year: 2027 });
    expect(renewalTarget([])).toBeNull();
  });
});

describe("heldWindows", () => {
  it("renews the confirmed windows, or the requested ones when none are", () => {
    const w = (status: string, n: number) => ({ status, n });
    expect(
      heldWindows([w("confirmed", 1), w("requested", 2), w("lost", 3)]).map(
        (x) => x.n,
      ),
    ).toEqual([1]);
    expect(
      heldWindows([w("requested", 2), w("lost", 3)]).map((x) => x.n),
    ).toEqual([2]);
    expect(heldWindows([w("lost", 3)])).toEqual([]);
  });
});

describe("splitRenewal", () => {
  it("says how many dates fall outside the next period", () => {
    const summer: Pattern[] = [
      { ...held[0]!, dates: ["2026-08-16", "2026-08-23", "2026-09-06"] },
    ];
    const plan = splitRenewal(summer, [same], nextYear(periodOf("2026-08-16")));
    expect(plan.renewal.map((r) => r.date)).toEqual([
      "2027-08-15",
      "2027-08-22",
    ]);
    expect(plan.warnings).toEqual([
      {
        kind: "outside_period",
        place: "McCarren Park, Field 2",
        weekday: 0,
        dates: 1,
      },
    ]);
  });

  it("renews what was held, unchanged, with no warning", () => {
    const plan = splitRenewal(held, [same], target);
    expect(plan.renewal).toEqual([
      {
        date: "2027-09-12",
        place: "McCarren Park, Field 2",
        start: "12:00",
        end: "18:00",
      },
      {
        date: "2027-09-19",
        place: "McCarren Park, Field 2",
        start: "12:00",
        end: "18:00",
      },
    ]);
    expect(plan.extra).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.renewalHours).toBe(12);
  });

  it("splits more hours off as a new request", () => {
    const plan = splitRenewal(
      held,
      [{ ...same, start: "10:00", end: "20:00" }],
      target,
    );
    expect(
      plan.renewal.every((r) => r.start === "12:00" && r.end === "18:00"),
    ).toBe(true);
    expect(plan.extra.map((r) => `${r.date} ${r.start}-${r.end}`)).toEqual([
      "2027-09-12 10:00-12:00",
      "2027-09-12 18:00-20:00",
      "2027-09-19 10:00-12:00",
      "2027-09-19 18:00-20:00",
    ]);
    expect(plan.extraHours).toBe(8);
    expect(plan.warnings).toEqual([
      {
        kind: "more_time",
        place: "McCarren Park, Field 2",
        weekday: 0,
        extra: ["10:00–12:00", "18:00–20:00"],
      },
    ]);
  });

  it("keeps the held hours when the owners ask for fewer, and says why", () => {
    const plan = splitRenewal(
      held,
      [{ ...same, start: "13:00", end: "17:00" }],
      target,
    );
    expect(plan.renewalHours).toBe(12);
    expect(plan.extra).toEqual([]);
    expect(plan.warnings.map((w) => w.kind)).toEqual(["changed_hours"]);
  });

  it("flags a shifted window as changed and splits off only the new part", () => {
    const plan = splitRenewal(
      held,
      [{ ...same, start: "14:00", end: "20:00" }],
      target,
    );
    expect(plan.warnings.map((w) => w.kind)).toEqual([
      "changed_hours",
      "more_time",
    ]);
    expect(plan.extra.map((r) => `${r.start}-${r.end}`)).toEqual([
      "18:00-20:00",
      "18:00-20:00",
    ]);
  });

  it("warns about a dropped pattern and renews nothing for it", () => {
    const plan = splitRenewal(held, [], target);
    expect(plan.renewal).toEqual([]);
    expect(plan.warnings).toEqual([
      {
        kind: "dropped",
        place: "McCarren Park, Field 2",
        weekday: 0,
        held: "12:00–18:00",
      },
    ]);
  });

  it("asks for a new field or day over the renewal's weeks, as a new request", () => {
    const plan = splitRenewal(
      held,
      [
        same,
        {
          of: null,
          fieldId: "f3",
          place: "McCarren Park, Field 3",
          weekday: 6,
          start: "10:00",
          end: "14:00",
        },
      ],
      target,
    );
    expect(plan.extra.map((r) => `${r.date} ${r.place}`)).toEqual([
      "2027-09-18 McCarren Park, Field 3",
    ]);
    expect(plan.warnings.map((w) => w.kind)).toEqual(["new_field"]);
  });

  it("ignores wanted hours that end before they start", () => {
    const plan = splitRenewal(
      held,
      [{ ...same, start: "18:00", end: "12:00" }],
      target,
    );
    expect(plan.extra).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("warns past the 50-hour weekly renewal cap", () => {
    const many: Pattern[] = Array.from({ length: 9 }, (_, i) => ({
      ...held[0]!,
      key: `f${i}/0/12:00/18:00`,
      fieldId: `f${i}`,
    }));
    const plan = splitRenewal(
      many,
      many.map((p) => ({ ...same, of: p.key, fieldId: p.fieldId })),
      target,
    );
    expect(plan.warnings).toEqual([{ kind: "weekly_cap", hours: 54 }]);
  });
});

describe("the packet", () => {
  const field = (over: Partial<ParkField>): ParkField => ({
    id: "B058-ZN03-BASEBALL-1",
    park: "McCarren Park",
    borough: "B",
    kind: "diamond",
    kickball: true,
    adult: true,
    surface: "Natural",
    lit: false,
    lat: 40.7205,
    lng: -73.9517,
    ...over,
  });

  it("finds the borough of the park at a venue's pin", () => {
    const fields = [
      field({}),
      field({ borough: "M", lat: 40.78, lng: -73.97 }),
    ];
    expect(boroughAt(fields, { lat: 40.7207, lng: -73.9515 })).toBe("B");
    expect(boroughAt(fields, { lat: 40.6, lng: -74.2 })).toBeNull();
    expect(boroughAt(fields, null)).toBeNull();
  });

  it("groups bookings into one application per borough, unknown last", () => {
    expect(
      byBorough([
        { borough: null, n: 1 },
        { borough: "M", n: 2 },
        { borough: "B", n: 3 },
        { borough: "B", n: 4 },
      ]).map((g) => [g.borough, g.rows.map((r) => r.n)]),
    ).toEqual([
      ["B", [3, 4]],
      ["M", [2]],
      [null, [1]],
    ]);
  });

  const input: PacketInput = {
    league: "Example Kickball League",
    website: "https://kickball.example.test",
    season: { name: "Fall 2027", startsOn: "2027-09-12", endsOn: "2027-11-14" },
    applications: [
      {
        borough: "B",
        rows: [
          {
            date: "2027-09-12",
            field: "McCarren Park, Field 2",
            start: "12:00",
            end: "18:00",
          },
        ],
      },
    ],
    counts: { teams: 8, players: 112, games: 28, gameDays: 7 },
    rosters: null,
    insurance: null,
  };
  const name = (code: string) => (code === "B" ? "Brooklyn" : code);

  it("writes the packet as text, with counts and no names by default", () => {
    const text = packetText(input, name);
    expect(text).toContain("Website: https://kickball.example.test");
    expect(text).toContain("Players on rosters: 112");
    expect(text).toContain("BROOKLYN APPLICATION (6 FIELD HOURS)");
    expect(text).toContain(
      "Sunday 2027-09-12\tMcCarren Park, Field 2\t12:00–18:00",
    );
    expect(text).toContain("No certificate on file.");
    expect(text).not.toMatch(/^ROSTERS$/m);
  });

  it("adds the rosters and the certificate when they are there", () => {
    const text = packetText(
      {
        ...input,
        rosters: [
          { team: "Kick Bottom", players: ["Casey Captain", "Pat Player"] },
        ],
        insurance: {
          insurer: "Example Mutual",
          policyNumber: "GL-000",
          startsOn: "2027-01-01",
          expiresOn: "2028-01-01",
        },
      },
      name,
    );
    expect(text).toContain(
      "ROSTERS\n\nKick Bottom (2)\n  Casey Captain\n  Pat Player",
    );
    expect(text).toContain(
      "Example Mutual, policy GL-000: 2027-01-01 to 2028-01-01",
    );
  });
});
