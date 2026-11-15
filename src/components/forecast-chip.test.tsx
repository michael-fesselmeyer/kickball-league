// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForecastHour } from "@/domain/weather/forecast";
import { cachedForecast } from "@/lib/weather";
import { ForecastChip, ForecastChipView, ForecastSpace } from "./forecast-chip";

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

  it("says there is no forecast yet, in the forecast's own two lines", async () => {
    for (const hours of [null, []]) {
      vi.mocked(cachedForecast).mockResolvedValue(hours);
      const { container } = render(<dl>{await ForecastChip(GAME)}</dl>);
      expect(screen.getByText("No forecast yet")).toBeTruthy();
      expect(container.querySelectorAll("dd")).toHaveLength(2);
      cleanup();
    }
  });
});

describe("ForecastSpace", () => {
  it("holds the same two lines as the forecast, hidden from sight and screen readers", () => {
    const { container } = render(
      <dl>
        <ForecastSpace />
      </dl>,
    );
    const lines = [...container.querySelectorAll("dd")];
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.className).toContain("invisible");
      expect(line.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("ForecastChip with weather switched off", () => {
  it("keeps the forecast's space empty, so nothing below it moves", async () => {
    weatherOn.value = false;
    const { container } = render(
      <dl>
        {await ForecastChip({
          lat: 40.72,
          lng: -73.95,
          startsAt: new Date("2026-09-13T23:00:00Z"),
          endsAt: new Date("2026-09-14T00:00:00Z"),
        })}
      </dl>,
    );
    const lines = [...container.querySelectorAll("dd")];
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.getAttribute("aria-hidden") === "true")).toBe(
      true,
    );
    expect(cachedForecast).not.toHaveBeenCalledWith(40.72, -73.95);
    weatherOn.value = true;
  });
});
