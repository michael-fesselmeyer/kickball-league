import { describe, expect, it } from "vitest";
import { decide, rainFallen } from "@/domain/weather/decision";
import { gameForecast, rainRisk } from "@/domain/weather/forecast";
import {
  FIXTURE_ALERTS,
  FIXTURE_RAIN_CHANCE,
  FIXTURE_SHOWER_IN,
  FIXTURE_STATION,
  fixtureForecast,
  fixtureGrid,
  fixtureObservations,
  usesWeatherFixture,
} from "./weather-fixture";

const now = new Date("2026-11-14T15:20:00Z");
const nextGame = new Date("2026-11-18T01:00:00Z");
const game = (startsAt: Date) => ({
  startsAt,
  endsAt: new Date(startsAt.getTime() + 3_600_000),
});

describe("usesWeatherFixture", () => {
  it("is on only when asked for, and never on the league's own production site", () => {
    expect(usesWeatherFixture({}, true)).toBe(false);
    expect(usesWeatherFixture({ WEATHER_FIXTURE: "1" }, true)).toBe(false);
    const production = { WEATHER_FIXTURE: "true", NODE_ENV: "production" };
    expect(usesWeatherFixture(production, true)).toBe(true);
    expect(usesWeatherFixture(production, false)).toBe(false);
    expect(
      usesWeatherFixture({ WEATHER_FIXTURE: "true", NODE_ENV: "test" }, false),
    ).toBe(true);
  });
});

describe("fixtureForecast", () => {
  const hours = fixtureForecast(now, nextGame);

  it("covers the coming week hour by hour from the current hour", () => {
    expect(hours[0]?.startsAt).toEqual(new Date("2026-11-14T15:00:00Z"));
    expect(hours).toHaveLength(156);
    for (const [i, h] of hours.entries()) {
      expect(h.endsAt.getTime() - h.startsAt.getTime()).toBe(3_600_000);
      if (i > 0) expect(h.startsAt).toEqual(hours[i - 1]?.endsAt);
    }
  });

  it("puts the next game day on watch and leaves today dry", () => {
    expect(rainRisk(hours, [game(nextGame)]).level).toBe("watch");
    expect(gameForecast(hours, game(nextGame))?.precipChance).toBe(
      FIXTURE_RAIN_CHANCE,
    );
    const thisEvening = game(new Date("2026-11-14T22:00:00Z"));
    expect(rainRisk(hours, [thisEvening]).level).toBe("low");
  });

  it("is dry all week when there is no game to rain on", () => {
    const dry = fixtureForecast(now, null).map((h) => h.precipChance);
    expect(Math.max(...dry)).toBeLessThan(20);
  });

  it("is the same for any time within the hour", () => {
    expect(fixtureForecast(new Date("2026-11-14T15:55:00Z"), nextGame)).toEqual(
      hours,
    );
  });
});

describe("the rain-out card's demo weather", () => {
  const hours = fixtureForecast(now, nextGame);

  it("rains lightly only in the showery hours, with no thunder", () => {
    const grid = fixtureGrid(hours);
    expect(grid).toHaveLength(hours.length);
    for (const [i, g] of grid.entries()) {
      expect(g.startsAt).toEqual(hours[i]?.startsAt);
      expect(g.rainIn).toBe(
        (hours[i]?.precipChance ?? 0) >= FIXTURE_RAIN_CHANCE
          ? FIXTURE_SHOWER_IN
          : 0,
      );
      expect(g.thunderChance).toBeNull();
    }
  });

  it("reports a dry night at the nearest station, hourly at :51", () => {
    const reports = fixtureObservations(now);
    expect(reports).toHaveLength(48);
    expect(reports[0]?.at).toEqual(new Date("2026-11-14T14:51:00Z"));
    expect(reports.every((r) => r.at.getUTCMinutes() === 51)).toBe(true);
    expect(rainFallen(reports, now, 24)).toEqual({
      inches: 0,
      hoursReported: 24,
      hours: 24,
    });
  });

  it("reads as worth watching on the game day, as the demo's rain alert does", () => {
    const reports = fixtureObservations(now);
    const d = decide({
      hourly: hours,
      grid: fixtureGrid(hours),
      observed: {
        stationId: FIXTURE_STATION.id,
        stationName: FIXTURE_STATION.name,
        last24: rainFallen(reports, now, 24),
        last48: rainFallen(reports, now, 48),
      },
      alerts: [...FIXTURE_ALERTS],
      games: [game(nextGame)],
      now,
      timeZone: "America/New_York",
    });
    expect(d.level).toBe("watch");
    expect(d.summary).toMatch(/^Worth watching: 55% chance of rain/);
  });
});
