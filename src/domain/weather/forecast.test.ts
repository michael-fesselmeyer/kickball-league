import { describe, expect, it } from "vitest";
import {
  ALERT_AHEAD_MS,
  dueForRainCheck,
  type ForecastHour,
  gameForecast,
  hoursDuring,
  isThunder,
  rainRisk,
} from "./forecast";

const edt = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour + 4, minute));

// The same day as the recorded forecast (src/services/fixtures): a dry
// Saturday evening (Sep 12), showers building Sunday afternoon (24% at
// 1 PM, 52% from 3 PM) and thunderstorms Sunday evening (78% from 6 PM).
// Times are EDT; the temperature is 60 plus the hour, to tell hours apart.
const HOURS: readonly ForecastHour[] = Array.from({ length: 36 }, (_, i) => {
  const startsAt = new Date(edt(12, 18).getTime() + i * 3_600_000);
  const local = new Date(startsAt.getTime() - 4 * 3_600_000);
  const [day, hour] = [local.getUTCDate(), local.getUTCHours()];
  const [precipChance, summary]: [number, string] =
    day === 12
      ? [3, "Mostly Clear"]
      : day === 14 || hour < 12
        ? [8, "Partly Cloudy"]
        : hour < 15
          ? [24, "Slight Chance Rain Showers"]
          : hour < 18
            ? [52, "Chance Rain Showers"]
            : hour < 22
              ? [78, "Showers And Thunderstorms Likely"]
              : [35, "Chance Rain Showers"];
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    temperatureF: 60 + hour,
    precipChance,
    summary,
  };
});

const game = (day: number, hour: number, minute = 0) => ({
  startsAt: edt(day, hour, minute),
  endsAt: new Date(edt(day, hour, minute).getTime() + 55 * 60_000),
});

describe("gameForecast", () => {
  it("gives the temperature at kickoff and the wettest hour of the game", () => {
    expect(gameForecast(HOURS, game(13, 14, 30))).toEqual({
      temperatureF: 74,
      precipChance: 52,
      summary: "Chance Rain Showers",
      thunder: false,
    });
  });

  it("flags thunder during the game", () => {
    expect(gameForecast(HOURS, game(13, 19))).toMatchObject({
      precipChance: 78,
      thunder: true,
    });
  });

  it("says nothing for a game the forecast does not reach", () => {
    expect(gameForecast(HOURS, game(20, 19))).toBeNull();
    // Started before the forecast's first hour: no reading for kickoff.
    expect(gameForecast(HOURS, game(12, 17, 30))).toBeNull();
    expect(gameForecast([], game(13, 19))).toBeNull();
  });
});

describe("rainRisk", () => {
  it("is low when every game hour is under 40%", () => {
    expect(rainRisk(HOURS, [game(12, 18), game(13, 13)])).toEqual({
      level: "low",
      peakChance: 24,
      thunder: false,
      covered: 2,
    });
  });

  it("is on watch for a game hour at 40 to 69%", () => {
    expect(rainRisk(HOURS, [game(13, 13), game(13, 15)]).level).toBe("watch");
  });

  it("is likely at 70% or for thunderstorms", () => {
    expect(rainRisk(HOURS, [game(13, 15), game(13, 19)])).toEqual({
      level: "likely",
      peakChance: 78,
      thunder: true,
      covered: 2,
    });
    const storm = HOURS.map((h) => ({
      ...h,
      precipChance: 30,
      summary: "Isolated Thunderstorms",
    }));
    expect(rainRisk(storm, [game(13, 13)]).level).toBe("likely");
  });

  it("covers nothing when the forecast does not reach the games", () => {
    expect(rainRisk(HOURS, [game(20, 19)])).toEqual({
      level: "low",
      peakChance: 0,
      thunder: false,
      covered: 0,
    });
  });
});

describe("helpers", () => {
  it("finds the hours that overlap a window, in order", () => {
    const during = hoursDuring([...HOURS].reverse(), game(13, 18, 30));
    expect(during.map((h) => h.startsAt)).toEqual([edt(13, 18), edt(13, 19)]);
  });

  it("recognises thunder in the forecaster's words", () => {
    expect(isThunder("Showers And Thunderstorms Likely")).toBe(true);
    expect(isThunder("Chance Rain Showers")).toBe(false);
  });

  it("checks a game day from 30 hours ahead until its first pitch", () => {
    const pitch = edt(13, 13);
    const at = (msBefore: number) => new Date(pitch.getTime() - msBefore);
    expect(dueForRainCheck(pitch, at(ALERT_AHEAD_MS + 1))).toBe(false);
    expect(dueForRainCheck(pitch, at(ALERT_AHEAD_MS))).toBe(true);
    expect(dueForRainCheck(pitch, at(19 * 3_600_000))).toBe(true);
    expect(dueForRainCheck(pitch, at(0))).toBe(false);
  });
});
