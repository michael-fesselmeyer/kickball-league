import { describe, expect, it } from "vitest";
import {
  alertWeight,
  decide,
  type DecisionInput,
  type GridHour,
  hourWords,
  inches,
  type Observation,
  rainFallen,
  spanWords,
  type WeatherAlert,
} from "./decision";
import type { ForecastHour } from "./forecast";

const TZ = "America/New_York";
/** A Tuesday in September, EDT (UTC-4). */
const edt = (hour: number, minute = 0, day = 15) =>
  new Date(Date.UTC(2026, 8, day, hour + 4, minute));

const hourly = (chances: Record<number, [number, string?]>): ForecastHour[] =>
  Array.from({ length: 24 }, (_, hour) => {
    const [chance, summary] = chances[hour] ?? [5, "Partly Cloudy"];
    return {
      startsAt: edt(hour),
      endsAt: edt(hour + 1),
      temperatureF: 70,
      precipChance: chance,
      summary: summary ?? "Rain Showers",
    };
  });

const grid = (
  rain: Record<number, number>,
  thunder: Record<number, number> = {},
): GridHour[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    startsAt: edt(hour),
    rainIn: rain[hour] ?? 0,
    thunderChance: thunder[hour] ?? null,
  }));

/** Two games, 6 to 8 pm and 8 to 10 pm. */
const EVENING = [
  { startsAt: edt(18), endsAt: edt(20) },
  { startsAt: edt(20), endsAt: edt(22) },
];

const base = (extra: Partial<DecisionInput> = {}): DecisionInput => ({
  hourly: hourly({}),
  grid: grid({}),
  observed: {
    stationId: "KNYC",
    stationName: "New York City, Central Park",
    last24: { inches: 0, hoursReported: 24, hours: 24 },
    last48: { inches: 0, hoursReported: 48, hours: 48 },
  },
  alerts: [],
  games: EVENING,
  now: edt(14),
  timeZone: TZ,
  ...extra,
});

const fell = (in24: number, in48 = in24): DecisionInput["observed"] => ({
  stationId: "KNYC",
  stationName: "New York City, Central Park",
  last24: { inches: in24, hoursReported: 24, hours: 24 },
  last48: { inches: in48, hoursReported: 48, hours: 48 },
});

const alert = (event: string, endsAt: Date | null = null): WeatherAlert => ({
  event,
  headline: null,
  severity: "Severe",
  endsAt,
});

describe("the rain-out decision", () => {
  it("calls a dry evening playable and says why", () => {
    const d = decide(base());
    expect(d.level).toBe("low");
    expect(d.summary).toBe(
      "Looks playable: 5% chance of rain while games are on.",
    );
    expect(d.hours.map((h) => h.startsAt)).toEqual([
      edt(18),
      edt(19),
      edt(20),
      edt(21),
    ]);
  });

  it("reads a soaked field and evening storms as likely unplayable", () => {
    const d = decide(
      base({
        hourly: hourly({
          18: [70, "Showers And Thunderstorms"],
          19: [70, "Showers And Thunderstorms"],
          20: [30, "Chance Rain Showers"],
        }),
        observed: fell(0.62, 0.7),
      }),
    );
    expect(d.level).toBe("likely");
    expect(d.thunder).toBe(true);
    expect(d.summary).toBe(
      "Likely unplayable: 0.6 in fell in the last 24 hours and 70% chance of storms 6 to 8 pm.",
    );
  });

  it("watches a wet field even when game time looks dry", () => {
    expect(decide(base({ observed: fell(0.55) })).level).toBe("watch");
    expect(decide(base({ observed: fell(1.1) })).level).toBe("likely");
    // Rain still due before first pitch adds to what fell.
    const d = decide(
      base({ observed: fell(0.3), grid: grid({ 15: 0.15, 16: 0.1 }) }),
    );
    expect(d.beforePitchIn).toBeCloseTo(0.25);
    expect(d.level).toBe("watch");
    expect(d.summary).toContain("0.3 in fell in the last 24 hours");
    expect(d.summary).toContain("0.3 in more is due before first pitch");
  });

  it("does not count rain from hours already past toward the field", () => {
    const d = decide(base({ grid: grid({ 10: 0.8, 11: 0.4 }) }));
    expect(d.beforePitchIn).toBe(0);
    expect(d.level).toBe("low");
  });

  it("names the rain left from the day before when the last day was dry", () => {
    expect(decide(base({ observed: fell(0, 0.4) })).summary).toContain(
      "0.4 in fell in the last 2 days",
    );
  });

  it("puts a 40 to 69% evening on watch and totals the expected rain", () => {
    const d = decide(
      base({
        hourly: hourly({ 20: [55], 21: [45] }),
        grid: grid({ 20: 0.1, 21: 0.08 }),
      }),
    );
    expect(d.level).toBe("watch");
    expect(d.expectedIn).toBeCloseTo(0.18);
    expect(d.summary).toBe(
      "Worth watching: 55% chance of rain 8 to 10 pm and about 0.2 in expected during games.",
    );
  });

  it("takes thunder from the grid's chance of thunder too", () => {
    const d = decide(base({ grid: grid({}, { 19: 40 }) }));
    expect(d.thunder).toBe(true);
    expect(d.level).toBe("likely");
    expect(d.summary).toContain("chance of storms 7 to 8 pm");
  });

  it("lets a storm warning make it likely and a watch make it worth watching", () => {
    const warned = decide(
      base({ alerts: [alert("Severe Thunderstorm Warning", edt(19, 15))] }),
    );
    expect(warned.level).toBe("likely");
    expect(warned.summary).toContain(
      "a Severe Thunderstorm Warning until 7:15 pm",
    );
    expect(decide(base({ alerts: [alert("Flood Watch")] })).level).toBe(
      "watch",
    );
    // A heat advisory is shown elsewhere but does not bear on rain.
    expect(decide(base({ alerts: [alert("Heat Advisory")] })).level).toBe(
      "low",
    );
  });

  it("works with whatever parts it has", () => {
    const onlyGauge = decide(
      base({ hourly: null, grid: null, alerts: null, observed: fell(0.7) }),
    );
    expect(onlyGauge.level).toBe("watch");
    expect(onlyGauge.blind).toBe(false);
    expect(onlyGauge.summary).toBe(
      "Worth watching: 0.7 in fell in the last 24 hours.",
    );

    const nothing = decide(
      base({ hourly: null, grid: null, alerts: null, observed: null }),
    );
    expect(nothing.blind).toBe(true);
    expect(nothing.wetIn).toBeNull();
    expect(nothing.summary).toMatch(/hasn't answered/);
  });
});

describe("when the rain on the ground counts", () => {
  const nextWeek = [{ startsAt: edt(18, 0, 22), endsAt: edt(20, 0, 22) }];

  it("leaves last night's rain and today's alerts out of a game day a week away", () => {
    const d = decide(
      base({
        games: nextWeek,
        observed: fell(1.4),
        alerts: [alert("Severe Thunderstorm Warning")],
        grid: grid({ 15: 2 }),
      }),
    );
    expect(d.near).toBe(false);
    expect(d.wetIn).toBeNull();
    expect(d.beforePitchIn).toBe(0);
    expect(d.hazards).toEqual([]);
    expect(d.level).toBe("low");
    expect(d.summary).toBe(
      "Too early to tell: the hourly forecast doesn't reach this game day yet.",
    );
  });

  it("counts them from a day and a half out, and says when a day is over", () => {
    const tomorrow = [{ startsAt: edt(13, 0, 16), endsAt: edt(15, 0, 16) }];
    expect(decide(base({ games: tomorrow, observed: fell(0.6) })).level).toBe(
      "watch",
    );
    const yesterday = [{ startsAt: edt(18, 0, 14), endsAt: edt(20, 0, 14) }];
    expect(decide(base({ games: yesterday })).summary).toBe(
      "This game day is over.",
    );
  });
});

describe("rain a station measured", () => {
  const now = edt(14);
  const at = (hoursAgo: number, minute = 51) =>
    new Date(Date.UTC(2026, 8, 15, 18 - hoursAgo, minute));

  it("adds up routine hourly reports", () => {
    const obs: Observation[] = [
      { at: at(1), lastHourMm: 5.08 },
      { at: at(2), lastHourMm: 2.54 },
      { at: at(3), lastHourMm: null },
    ];
    const found = rainFallen(obs, now, 24);
    expect(found?.inches).toBeCloseTo(0.3);
    expect(found?.hoursReported).toBe(3);
  });

  it("keeps the largest figure from an hour's extra reports instead of adding them", () => {
    // An extra report at :20 counts the rain since the :51 report before it.
    const obs: Observation[] = [
      { at: at(1), lastHourMm: 6 },
      { at: at(1, 20), lastHourMm: 4 },
      { at: at(2), lastHourMm: 2 },
      { at: at(3), lastHourMm: 0 },
    ];
    expect(rainFallen(obs, now, 24)?.inches).toBeCloseTo(8 / 25.4);
  });

  it("leaves out reports older than the stretch, and says nothing without reports", () => {
    const obs: Observation[] = [
      { at: at(30), lastHourMm: 25.4 },
      { at: at(2), lastHourMm: 0 },
    ];
    expect(rainFallen(obs, now, 24)?.inches).toBe(0);
    expect(rainFallen(obs, now, 48)?.inches).toBeCloseTo(1);
    expect(rainFallen([], now, 24)).toBeNull();
  });
});

describe("the words the card uses", () => {
  it("writes inches, hours and spans in the league's time", () => {
    expect(inches(0.62)).toBe("0.6");
    expect(inches(0.06)).toBe("0.06");
    expect(hourWords(edt(18), TZ)).toBe("6 pm");
    expect(hourWords(edt(18, 30), TZ)).toBe("6:30 pm");
    expect(spanWords(edt(18), edt(20), TZ)).toBe("6 to 8 pm");
    expect(spanWords(edt(11), edt(13), TZ)).toBe("11 am to 1 pm");
  });

  it("weighs only alerts about weather that stops play", () => {
    expect(alertWeight(alert("Tornado Warning"))).toBe("likely");
    expect(alertWeight(alert("Severe Thunderstorm Watch"))).toBe("watch");
    expect(alertWeight(alert("Wind Advisory"))).toBe("watch");
    expect(alertWeight(alert("Air Quality Alert"))).toBe("low");
  });
});
