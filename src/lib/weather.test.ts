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
  nwsHourlyUrl: vi.fn(),
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

beforeEach(() => {
  vi.mocked(service.nwsHourlyUrl).mockReset();
  vi.mocked(service.nwsHourly).mockReset();
});

describe("cachedForecast", () => {
  it("looks up the place, then its hourly forecast, naming the site", async () => {
    vi.mocked(service.nwsHourlyUrl).mockResolvedValue(
      ok("https://api.weather.gov/gridpoints/OKX/34,36/forecast/hourly"),
    );
    vi.mocked(service.nwsHourly).mockResolvedValue(ok([HOUR]));
    expect(await cachedForecast(40.72061, -73.95129)).toEqual([HOUR]);
    expect(service.nwsHourlyUrl).toHaveBeenCalledWith(40.7206, -73.9513, {
      userAgent: "kickball-league (https://league.example.test)",
    });
  });

  it("is null, not an error, when either step fails", async () => {
    vi.mocked(service.nwsHourlyUrl).mockResolvedValue(err("down"));
    expect(await cachedForecast(40.7, -73.9)).toBeNull();
    expect(service.nwsHourly).not.toHaveBeenCalled();

    vi.mocked(service.nwsHourlyUrl).mockResolvedValue(
      ok("https://api.weather.gov/x"),
    );
    vi.mocked(service.nwsHourly).mockResolvedValue(err("slow"));
    expect(await cachedForecast(40.7, -73.9)).toBeNull();
  });
});
