// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForecastHour } from "@/domain/weather/forecast";
import { cachedForecast } from "@/lib/weather";
import { ForecastChip, ForecastChipView } from "./forecast-chip";

// The real lookup reads the environment and the data cache.
vi.mock("@/lib/weather", () => ({ cachedForecast: vi.fn() }));
// The operator's feature switch reads the database.
const weatherOn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/platform/site", () => ({
  featureEnabled: async () => weatherOn.value,
}));

afterEach(cleanup);

const HOUR: ForecastHour = {
  startsAt: new Date("2026-09-13T23:00:00Z"),
  endsAt: new Date("2026-09-14T00:00:00Z"),
  temperatureF: 69.4,
  precipChance: 78,
  summary: "Showers And Thunderstorms Likely",
};
const GAME = {
  lat: 40.7206,
  lng: -73.9513,
  startsAt: new Date("2026-09-13T23:00:00Z"),
  endsAt: new Date("2026-09-13T23:55:00Z"),
};

const forecast = {
  temperatureF: 69,
  precipChance: 78,
  summary: "Showers And Thunderstorms Likely",
  thunder: true,
};

describe("ForecastChipView", () => {
  it("shows the temperature, the chance of rain and where it comes from", () => {
    render(
      <dl>
        <ForecastChipView forecast={forecast} />
      </dl>,
    );
    expect(screen.getByText(/69°F · 78% chance of rain/)).toBeTruthy();
    expect(
      screen.getByText(
        "Showers And Thunderstorms Likely. Forecast from the National Weather Service.",
      ),
    ).toBeTruthy();
  });

  it("hides its weather icon from screen readers", () => {
    const { container } = render(
      <dl>
        <ForecastChipView
          forecast={{ ...forecast, thunder: false, precipChance: 5 }}
        />
      </dl>,
    );
    const icon = container.querySelector("[aria-hidden='true']");
    expect(icon?.textContent).toBe("🌤️");
  });
});

describe("ForecastChip", () => {
  it("reads the cached forecast for the game's park and hours", async () => {
    vi.mocked(cachedForecast).mockResolvedValue([HOUR]);
    render(<dl>{await ForecastChip(GAME)}</dl>);
    expect(screen.getByText(/69°F · 78% chance of rain/)).toBeTruthy();
    expect(cachedForecast).toHaveBeenCalledWith(40.7206, -73.9513);
  });

  it("renders nothing without a forecast for the game", async () => {
    vi.mocked(cachedForecast).mockResolvedValue(null);
    expect(await ForecastChip(GAME)).toBeNull();
    vi.mocked(cachedForecast).mockResolvedValue([]);
    expect(await ForecastChip(GAME)).toBeNull();
  });
});

describe("ForecastChip with weather switched off", () => {
  it("renders nothing", async () => {
    weatherOn.value = false;
    const { container } = render(
      await ForecastChip({
        lat: 40.72,
        lng: -73.95,
        startsAt: new Date("2026-09-13T23:00:00Z"),
        endsAt: new Date("2026-09-14T00:00:00Z"),
      }),
    );
    expect(container.innerHTML).toBe("");
    weatherOn.value = true;
  });
});
