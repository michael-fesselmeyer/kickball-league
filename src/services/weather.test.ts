import { describe, expect, it, vi } from "vitest";
import { rainFallen } from "@/domain/weather/decision";
import { gameForecast, rainRisk } from "@/domain/weather/forecast";
import alertsFixture from "./fixtures/nws-alerts.json";
import gridFixture from "./fixtures/nws-griddata.json";
import hourlyFixture from "./fixtures/nws-hourly.json";
import observationsFixture from "./fixtures/nws-observations.json";
import pointFixture from "./fixtures/nws-points.json";
import stationsFixture from "./fixtures/nws-stations.json";
import {
  alertsUrl,
  durationHours,
  nwsAlerts,
  nwsGrid,
  nwsHourly,
  nwsHourlyUrl,
  nwsObservations,
  observationsUrl,
  parseAlerts,
  parseGrid,
  parseHourly,
  parseObservations,
  parsePoint,
  parsePointLinks,
  parseStations,
  pointUrl,
  roundCoordinate,
  type WeatherFetch,
} from "./weather";

const HOURLY = "https://api.weather.gov/gridpoints/OKX/34,36/forecast/hourly";

/** Answers from the fixtures; tests never reach the network. */
function fixtureFetch(): WeatherFetch & { calls: string[] } {
  const calls: string[] = [];
  const answer: WeatherFetch = async (url) => {
    calls.push(url);
    const body = url.startsWith("https://api.weather.gov/points/")
      ? pointFixture
      : url === HOURLY
        ? hourlyFixture
        : null;
    return {
      ok: body !== null,
      status: body ? 200 : 404,
      json: async () => body,
    };
  };
  return Object.assign(answer, { calls });
}

const options = (fetch: WeatherFetch) => ({
  userAgent: "kickball-league (https://league.example.test)",
  fetch,
});

describe("the National Weather Service client", () => {
  it("looks up a place's hourly forecast with a User-Agent and four decimals", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetch: WeatherFetch = async (url, init) => {
      calls.push({ url, headers: init.headers });
      return { ok: true, status: 200, json: async () => pointFixture };
    };
    const found = await nwsHourlyUrl(40.72061234, -73.95129876, options(fetch));
    expect(found).toEqual({ ok: true, value: HOURLY });
    expect(calls[0]?.url).toBe(
      "https://api.weather.gov/points/40.7206,-73.9513",
    );
    expect(calls[0]?.headers["User-Agent"]).toBe(
      "kickball-league (https://league.example.test)",
    );
  });

  it("reads the recorded hourly forecast in Fahrenheit, with chances of rain", async () => {
    const fetch = fixtureFetch();
    const found = await nwsHourly(HOURLY, options(fetch));
    if (!found.ok) throw new Error(found.error);
    expect(found.value).toHaveLength(36);
    expect(found.value[0]).toEqual({
      startsAt: new Date("2026-09-12T22:00:00Z"),
      endsAt: new Date("2026-09-12T23:00:00Z"),
      temperatureF: 73,
      precipChance: 3,
      summary: "Mostly Clear",
    });
    expect(fetch.calls).toEqual([HOURLY]);
  });

  it("puts the recorded Sunday on watch in the afternoon and likely at night", async () => {
    const found = await nwsHourly(HOURLY, options(fixtureFetch()));
    if (!found.ok) throw new Error(found.error);
    // EDT kickoffs on Sunday, Sep 13, each 55 minutes long.
    const at = (hour: number) => {
      const startsAt = new Date(Date.UTC(2026, 8, 13, hour + 4));
      return { startsAt, endsAt: new Date(startsAt.getTime() + 55 * 60_000) };
    };
    expect(rainRisk(found.value, [at(10), at(13)]).level).toBe("low");
    expect(rainRisk(found.value, [at(13), at(15)]).level).toBe("watch");
    expect(rainRisk(found.value, [at(15), at(19)]).level).toBe("likely");
    expect(gameForecast(found.value, at(19))).toEqual({
      temperatureF: 67,
      precipChance: 78,
      summary: "Showers And Thunderstorms Likely",
      thunder: true,
    });
  });

  it("converts Celsius and treats a missing chance of rain as none", () => {
    const parsed = parseHourly({
      properties: {
        periods: [
          {
            startTime: "2026-09-13T19:00:00-04:00",
            endTime: "2026-09-13T20:00:00-04:00",
            temperature: 20,
            temperatureUnit: "C",
            probabilityOfPrecipitation: { value: null },
            shortForecast: "Cloudy",
          },
        ],
      },
    });
    expect(parsed.ok && parsed.value[0]).toMatchObject({
      temperatureF: 68,
      precipChance: 0,
    });
  });

  it("says why when the service answers badly or not at all", async () => {
    const down: WeatherFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    expect(await nwsHourlyUrl(40.7, -73.9, options(down))).toEqual({
      ok: false,
      error: "The forecast service answered 503",
    });

    const unreachable: WeatherFetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await nwsHourly(HOURLY, options(unreachable))).toEqual({
      ok: false,
      error: "The forecast service could not be reached",
    });

    const slow: WeatherFetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      );
    expect(await nwsHourly(HOURLY, { ...options(slow), timeoutMs: 5 })).toEqual(
      { ok: false, error: "The forecast service took too long" },
    );
  });

  it("refuses answers it cannot read or that point at another host", async () => {
    expect(parsePoint({ properties: {} }).ok).toBe(false);
    expect(
      parsePoint({
        properties: { forecastHourly: "https://elsewhere.example.test/x" },
      }),
    ).toEqual({ ok: false, error: "The point lookup named another host" });
    expect(parseHourly({ properties: { periods: [{}] } }).ok).toBe(false);
    const fetch = vi.fn<WeatherFetch>();
    expect(
      await nwsHourly("https://elsewhere.example.test/x", options(fetch)),
    ).toEqual({ ok: false, error: "Not a forecast service address" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rounds coordinates to what the service accepts", () => {
    expect(roundCoordinate(40.72064999)).toBe(40.7206);
    expect(pointUrl(40.7, -73.95)).toBe(
      "https://api.weather.gov/points/40.7,-73.95",
    );
  });
});

describe("what the rain-out decision reads from NWS", () => {
  it("finds the grid, hourly forecast and nearest stations from the point", () => {
    expect(parsePointLinks(pointFixture)).toEqual({
      ok: true,
      value: {
        hourly: HOURLY,
        grid: "https://api.weather.gov/gridpoints/OKX/34,36",
        stations: "https://api.weather.gov/gridpoints/OKX/34,36/stations",
      },
    });
    expect(
      parsePointLinks({
        properties: {
          forecastHourly: HOURLY,
          forecastGridData: "https://elsewhere.example.test/grid",
          observationStations: HOURLY,
        },
      }),
    ).toEqual({ ok: false, error: "The point lookup named another host" });
  });

  it("spreads the grid's rainfall over the hours it covers, in inches", () => {
    const found = parseGrid(gridFixture);
    if (!found.ok) throw new Error(found.error);
    // 6 hours of 7.62 mm, 6 dry hours, and a day with no figure.
    expect(found.value).toHaveLength(36);
    expect(found.value[0]).toEqual({
      startsAt: new Date("2026-09-15T18:00:00Z"),
      rainIn: expect.closeTo(0.05, 5),
      thunderChance: 0,
    });
    expect(found.value[4]?.thunderChance).toBe(40);
    expect(found.value[6]).toMatchObject({ rainIn: 0, thunderChance: null });
    expect(found.value.at(-1)?.rainIn).toBe(0);
  });

  it("reads ISO durations in whole hours", () => {
    expect(durationHours("PT1H")).toBe(1);
    expect(durationHours("P1DT6H")).toBe(30);
    expect(durationHours("PT30M")).toBe(1);
    expect(durationHours("P")).toBeNull();
    expect(durationHours("soon")).toBeNull();
    expect(
      parseGrid({
        properties: {
          quantitativePrecipitation: {
            values: [{ validTime: "2026-09-15T18:00:00+00:00/soon", value: 1 }],
          },
        },
      }),
    ).toEqual({ ok: false, error: "The grid forecast had a bad time" });
  });

  it("lists the nearest stations and what the nearest one measured", () => {
    expect(parseStations(stationsFixture)).toEqual({
      ok: true,
      value: [
        { id: "KNYC", name: "New York City, Central Park" },
        { id: "KLGA", name: "New York, La Guardia Airport" },
      ],
    });
    const found = parseObservations(observationsFixture);
    if (!found.ok) throw new Error(found.error);
    expect(found.value).toHaveLength(6);
    expect(found.value[1]).toEqual({
      at: new Date("2026-09-15T08:51:00Z"),
      lastHourMm: 6.1,
    });
    expect(found.value[5]?.lastHourMm).toBeNull();
    // An extra report at 08:12 is inside the hour the 08:51 report closes.
    const now = new Date("2026-09-15T18:00:00Z");
    expect(rainFallen(found.value, now, 24)?.inches).toBeCloseTo(15.8 / 25.4);
    expect(rainFallen(found.value, now, 48)?.inches).toBeCloseTo(18.3 / 25.4);
  });

  it("reads active alerts, falling back to when an alert expires", () => {
    const found = parseAlerts(alertsFixture);
    if (!found.ok) throw new Error(found.error);
    expect(found.value).toEqual([
      {
        event: "Severe Thunderstorm Warning",
        headline: expect.stringMatching(/^Severe Thunderstorm Warning issued/),
        severity: "Severe",
        endsAt: new Date("2026-09-16T02:30:00Z"),
      },
      {
        event: "Heat Advisory",
        headline: null,
        severity: "Moderate",
        endsAt: new Date("2026-09-16T00:00:00Z"),
      },
    ]);
  });

  it("asks for a station's reports and a point's alerts at NWS only", async () => {
    const fetch = fixtureFetch();
    const since = new Date("2026-09-13T18:00:00.000Z");
    expect(observationsUrl("KNYC", since)).toBe(
      "https://api.weather.gov/stations/KNYC/observations?start=2026-09-13T18:00:00Z",
    );
    expect(alertsUrl(40.72061, -73.95129)).toBe(
      "https://api.weather.gov/alerts/active?point=40.7206,-73.9513",
    );
    expect(await nwsObservations("../x", since, options(fetch))).toEqual({
      ok: false,
      error: "Not a station",
    });
    expect(
      await nwsGrid("https://elsewhere.example.test/grid", options(fetch)),
    ).toEqual({ ok: false, error: "Not a forecast service address" });
    expect(fetch.calls).toEqual([]);
    const down: WeatherFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    expect(await nwsAlerts(40.7, -73.9, options(down))).toEqual({
      ok: false,
      error: "The forecast service answered 500",
    });
  });
});
