import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/domain/result";
import type { ForecastHour } from "@/domain/weather/forecast";
import type * as Weather from "@/services/weather";

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://league.example.test" },
}));
vi.mock("@/services/weather", async (original) => ({
  ...(await original<typeof Weather>()),
  nwsPointLinks: vi.fn(),
  nwsHourly: vi.fn(),
}));

const service = await import("@/services/weather");
const { cachedForecast } = await import("./weather");

const HOUR: ForecastHour = {
  startsAt: new Date("2026-09-13T23:00:00Z"),
  endsAt: new Date("2026-09-14T00:00:00Z"),
  temperatureF: 69,
  precipChance: 78,
  summary: "Showers And Thunderstorms Likely",
};

const LINKS = {
  hourly: "https://api.weather.gov/gridpoints/OKX/34,36/forecast/hourly",
  grid: "https://api.weather.gov/gridpoints/OKX/34,36",
  stations: "https://api.weather.gov/gridpoints/OKX/34,36/stations",
};

beforeEach(() => {
  vi.mocked(service.nwsPointLinks).mockReset();
  vi.mocked(service.nwsHourly).mockReset();
});

describe("cachedForecast", () => {
  it("looks up the place, then its hourly forecast, naming the site", async () => {
    vi.mocked(service.nwsPointLinks).mockResolvedValue(ok(LINKS));
    vi.mocked(service.nwsHourly).mockResolvedValue(ok([HOUR]));
    expect(await cachedForecast(40.72061, -73.95129)).toEqual([HOUR]);
    expect(service.nwsPointLinks).toHaveBeenCalledWith(
      40.7206,
      -73.9513,
      expect.objectContaining({
        userAgent: "kickball-league (https://league.example.test)",
      }),
    );
    expect(service.nwsHourly).toHaveBeenCalledWith(
      LINKS.hourly,
      expect.anything(),
    );
  });

  it("is null, not an error, when either step fails", async () => {
    vi.mocked(service.nwsPointLinks).mockResolvedValue(err("down"));
    expect(await cachedForecast(40.7, -73.9)).toBeNull();
    expect(service.nwsHourly).not.toHaveBeenCalled();

    vi.mocked(service.nwsPointLinks).mockResolvedValue(ok(LINKS));
    vi.mocked(service.nwsHourly).mockResolvedValue(err("slow"));
    expect(await cachedForecast(40.7, -73.9)).toBeNull();
  });

  it("never plays the forecast back on the league's own site", async () => {
    vi.mocked(service.nwsPointLinks).mockResolvedValue(ok(LINKS));
    vi.mocked(service.nwsHourly).mockResolvedValue(ok([HOUR]));
    await cachedForecast(40.72, -73.95);
    // No injected fetch: the real NWS, unless WEATHER_FIXTURE says otherwise.
    expect(
      vi.mocked(service.nwsPointLinks).mock.calls[0]?.[2],
    ).not.toHaveProperty("fetch");
  });
});
