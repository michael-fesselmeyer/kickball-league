import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ParkField } from "../capacity/nearby";
import {
  ADULT_RATES,
  estimateWindow,
  feesDueOn,
  guessField,
  LIGHTS_RATE,
  surfaceOf,
} from "./fees";
import { formAnswers, formText, officeFor } from "./give-back";
import {
  hoursLevel,
  hoursText,
  minutesWithSheet,
  permittedMinutes,
} from "./hours";
import { permitPlan, type PlanWindow } from "./plan";
import { NEW_YORK, sunset } from "./sun";

const at = (iso: string) => new Date(iso);

describe("sunset", () => {
  // timeanddate.com's New York sunsets, as quoted in docs/permits/nyc-parks.md.
  it.each([
    ["2026-09-01", "2026-09-01T23:28:00Z"],
    ["2026-09-30", "2026-09-30T22:39:00Z"],
    ["2026-11-28", "2026-11-28T21:30:00Z"],
  ])(
    "sets on %s within three minutes of the published time",
    (on, expected) => {
      const found = sunset(on, NEW_YORK);
      expect(found).not.toBeNull();
      expect(
        Math.abs((found?.getTime() ?? 0) - Date.parse(expected)) / 60_000,
      ).toBeLessThanOrEqual(3);
    },
  );

  it("returns null for a date it cannot read, and where the sun doesn't set", () => {
    expect(sunset("not a date", NEW_YORK)).toBeNull();
    expect(sunset("2026-06-21", { lat: 80, lng: 0 })).toBeNull();
  });
});

describe("surfaceOf", () => {
  it("maps NYC Open Data's surfaces to NYC Parks' fee rows", () => {
    expect(surfaceOf("Natural")).toBe("grass");
    expect(surfaceOf("Synthetic - Large/Full")).toBe("synthetic_large");
    expect(surfaceOf("Synthetic - Multi")).toBe("synthetic_multi");
    expect(surfaceOf("Asphalt")).toBe("hard_top");
  });
});

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

describe("guessField", () => {
  const fields = [
    field({}),
    field({ id: "B058-ZN03-BASEBALL-2", surface: "Natural" }),
    field({
      id: "B058-ZN03-SOCCER-1",
      kind: "large",
      kickball: false,
      surface: "Synthetic - Large/Full",
    }),
    field({
      id: "M010-BASEBALL-1",
      park: "Central Park",
      borough: "M",
      lat: 40.78,
      lng: -73.97,
      surface: "Synthetic - Multi",
    }),
  ];
  const mccarren = { lat: 40.7207, lng: -73.9515 };

  it("matches the league's field by its NYC Parks name", () => {
    expect(guessField(fields, mccarren, "Soccer 1")).toEqual({
      surface: "synthetic_large",
      basis: "matched",
      borough: "B",
      park: "McCarren Park",
    });
  });

  it("uses the surface every kickball field in the park shares", () => {
    expect(guessField(fields, mccarren, "Field 2")).toMatchObject({
      surface: "grass",
      basis: "park",
      park: "McCarren Park",
    });
  });

  it("assumes grass, with the borough, when the kickball fields differ", () => {
    const mixed = [
      ...fields,
      field({ id: "B058-ZN03-BASEBALL-3", surface: "Synthetic - Multi" }),
    ];
    expect(guessField(mixed, mccarren, "Field 2")).toMatchObject({
      surface: "grass",
      basis: "assumed",
      borough: "B",
    });
  });

  it("assumes grass with no park when the venue has no pin or no park is near", () => {
    expect(guessField(fields, null, "Field 1").basis).toBe("assumed");
    expect(guessField(fields, { lat: 40.6, lng: -74.2 }, "Field 1")).toEqual({
      surface: "grass",
      basis: "assumed",
      borough: null,
      park: null,
    });
  });
});

describe("estimateWindow", () => {
  it("charges the surface's hourly rate and lights after sunset", () => {
    const e = estimateWindow(
      {
        startsAt: at("2026-09-30T22:00:00Z"),
        endsAt: at("2026-10-01T01:00:00Z"),
      },
      "grass",
      at("2026-09-30T22:39:00Z"),
    );
    expect(e.minutes).toBe(180);
    expect(e.litMinutes).toBe(141);
    expect(e.cents).toBe(
      Math.round((ADULT_RATES.grass * 180 + LIGHTS_RATE * 141) / 60),
    );
  });

  it("charges no lights for daytime play, and lights for all of a night game", () => {
    const day = estimateWindow(
      {
        startsAt: at("2026-09-06T16:00:00Z"),
        endsAt: at("2026-09-06T22:00:00Z"),
      },
      "synthetic_large",
      at("2026-09-06T23:20:00Z"),
    );
    expect(day).toEqual({ minutes: 360, litMinutes: 0, cents: 6 * 4100 });
    const night = estimateWindow(
      {
        startsAt: at("2026-11-02T00:00:00Z"),
        endsAt: at("2026-11-02T02:00:00Z"),
      },
      "grass",
      at("2026-11-01T21:50:00Z"),
    );
    expect(night).toEqual({
      minutes: 120,
      litMinutes: 120,
      cents: 2 * (2400 + 1500),
    });
  });

  it("is never negative and never counts more lit time than the window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: -600, max: 1200 }),
        (length, sunsetAfter) => {
          const startsAt = at("2026-10-01T20:00:00Z");
          const endsAt = new Date(startsAt.getTime() + length * 60_000);
          const e = estimateWindow(
            { startsAt, endsAt },
            "grass",
            new Date(startsAt.getTime() + sunsetAfter * 60_000),
          );
          return e.cents >= 0 && e.litMinutes >= 0 && e.litMinutes <= e.minutes;
        },
      ),
    );
  });
});

describe("feesDueOn", () => {
  it("is 14 days before the season starts", () => {
    expect(feesDueOn("2027-04-04")).toBe("2027-03-21");
    expect(feesDueOn("2027-03-10")).toBe("2027-02-24");
  });
});

describe("the 50-hour line", () => {
  it("is close from 40 hours and over past 50", () => {
    expect(hoursLevel(39.5 * 60)).toBe("under");
    expect(hoursLevel(40 * 60)).toBe("near");
    expect(hoursLevel(50 * 60)).toBe("near");
    expect(hoursLevel(50 * 60 + 1)).toBe("over");
    expect(hoursText(37.5 * 60)).toBe("37.5");
  });

  it("adds an extra request on top, and takes a whole-season sheet as the ask", () => {
    expect(minutesWithSheet(30 * 60, 24 * 60, true)).toBe(54 * 60);
    expect(minutesWithSheet(30 * 60, 24 * 60, false)).toBe(30 * 60);
    expect(minutesWithSheet(30 * 60, 54 * 60, false)).toBe(54 * 60);
  });

  it("counts requested and confirmed windows, not lost ones", () => {
    const w = (status: string, hours: number) => ({
      startsAt: at("2026-09-06T16:00:00Z"),
      endsAt: new Date(Date.parse("2026-09-06T16:00:00Z") + hours * 3_600_000),
      status,
    });
    expect(
      permittedMinutes([w("requested", 6), w("confirmed", 6), w("lost", 6)]),
    ).toBe(720);
  });
});

describe("giving time back", () => {
  const giveBack = {
    permitNumber: "123456",
    holder: "Example Kickball League",
    on: "2026-09-13",
    borough: "B",
    park: "McCarren Park",
    field: "Baseball 2",
    start: "12:00",
    end: "18:00",
    reason: "rained_out" as const,
  };

  it("fills in NYC Parks' cancellation form in its order", () => {
    expect(formAnswers(giveBack).map((a) => a.answer)).toEqual([
      "123456",
      "Example Kickball League",
      "2026-09-13",
      "BK",
      "McCarren Park, Baseball 2, 12:00–18:00. Our games that day were rained out and moved to another date.",
    ]);
    expect(formText(giveBack)).toContain("Permit Number: 123456\n");
  });

  it("asks the owner for what it doesn't know", () => {
    const answers = formAnswers({
      ...giveBack,
      permitNumber: null,
      borough: null,
    });
    expect(answers[0]?.answer).toMatch(/copy it from the permit/);
    expect(answers[3]?.answer).toBe("Pick the borough");
  });

  it("names the borough office, with Prospect Park's own line", () => {
    expect(officeFor("B", "McCarren Park")).toEqual({
      name: "Brooklyn permit office",
      phone: "(718) 965-8975",
    });
    expect(officeFor("B", "Prospect Park")?.phone).toBe("(718) 965-8974");
    expect(officeFor("X", null)?.phone).toBe("(718) 430-1840");
    expect(officeFor(null, null)).toBeNull();
  });
});

describe("permitPlan", () => {
  const tz = "America/New_York";
  const base: PlanWindow = {
    id: "w1",
    group: "n:123456",
    fieldId: "f1",
    fieldName: "Baseball 1",
    venueName: "McCarren Park",
    venue: { lat: 40.7207, lng: -73.9515 },
    startsAt: at("2026-09-13T16:00:00Z"),
    endsAt: at("2026-09-13T22:00:00Z"),
    status: "confirmed",
    permitNumber: "123456",
    costCents: null,
    slots: 6,
    cancelledSlots: 0,
  };
  const plan = (windows: PlanWindow[], blackouts: string[] = []) =>
    permitPlan({
      windows,
      blackouts: new Set(blackouts),
      parkFields: [field({})],
      timeZone: tz,
      now: at("2026-09-10T15:00:00Z"),
      holder: "Example Kickball League",
    });

  it("estimates each permit, and counts only those without a cost as expected", () => {
    const result = plan([
      base,
      {
        ...base,
        id: "w2",
        startsAt: at("2026-09-20T16:00:00Z"),
        endsAt: at("2026-09-20T22:00:00Z"),
      },
      {
        ...base,
        id: "w3",
        group: "n:654321",
        permitNumber: "654321",
        costCents: 5000,
      },
      { ...base, id: "w4", group: "n:999999", status: "lost" },
    ]);
    expect(result.fees.get("n:123456")).toMatchObject({
      surface: "grass",
      basis: "matched",
      costEntered: false,
      estimate: { minutes: 720, litMinutes: 0, cents: 12 * 2400 },
    });
    expect(result.fees.get("n:654321")?.costEntered).toBe(true);
    expect(result.fees.has("n:999999")).toBe(false);
    expect(result.expectedCents).toBe(12 * 2400);
    expect(result.minutes).toBe(18 * 60);
    expect(result.level).toBe("under");
  });

  it("lists rained-out and blacked-out windows still ahead, not past ones", () => {
    const result = plan(
      [
        { ...base, cancelledSlots: 6 },
        {
          ...base,
          id: "w2",
          startsAt: at("2026-09-20T16:00:00Z"),
          endsAt: at("2026-09-20T22:00:00Z"),
        },
        {
          ...base,
          id: "w3",
          startsAt: at("2026-09-06T16:00:00Z"),
          endsAt: at("2026-09-06T22:00:00Z"),
          cancelledSlots: 6,
        },
        {
          ...base,
          id: "w4",
          startsAt: at("2026-09-27T16:00:00Z"),
          endsAt: at("2026-09-27T22:00:00Z"),
          slots: 0,
        },
      ],
      ["2026-09-20"],
    );
    expect(result.unused.map((u) => [u.windowId, u.reason])).toEqual([
      ["w1", "rained_out"],
      ["w2", "blackout"],
    ]);
    expect(result.unused[0]).toMatchObject({
      on: "2026-09-13",
      start: "12:00",
      end: "18:00",
      park: "McCarren Park",
      office: { phone: "(718) 965-8975" },
    });
  });

  it("leaves out time that has already started", () => {
    const started = permitPlan({
      windows: [{ ...base, cancelledSlots: 6 }],
      blackouts: new Set(),
      parkFields: [field({})],
      timeZone: tz,
      now: at("2026-09-13T16:30:00Z"),
      holder: "Example Kickball League",
    });
    expect(started.unused).toEqual([]);
    const later = permitPlan({
      windows: [{ ...base, cancelledSlots: 6 }],
      blackouts: new Set(),
      parkFields: [field({})],
      timeZone: tz,
      now: at("2026-09-13T15:59:00Z"),
      holder: "Example Kickball League",
    });
    expect(later.unused).toHaveLength(1);
  });

  it("counts a blackout on the window's own field", () => {
    const result = plan([base], ["2026-09-13/f1"]);
    expect(result.unused.map((u) => u.reason)).toEqual(["blackout"]);
    expect(plan([base], ["2026-09-13/f2"]).unused).toEqual([]);
  });
});
