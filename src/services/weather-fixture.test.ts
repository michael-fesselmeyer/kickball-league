import { describe, expect, it } from "vitest";
import { gameForecast, rainRisk } from "@/domain/weather/forecast";
import {
  FIXTURE_RAIN_CHANCE,
  fixtureForecast,
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
