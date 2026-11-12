import {
  type GameForecast,
  gameForecast,
  WATCH_AT,
} from "@/domain/weather/forecast";
import { cachedForecast } from "@/lib/weather";

const icon = (f: GameForecast) =>
  f.thunder
    ? "⛈️"
    : f.precipChance >= WATCH_AT
      ? "🌧️"
      : f.precipChance >= 20
        ? "🌦️"
        : "🌤️";

/** The forecast line inside a game page's "When" card, as dd items. */
export function ForecastChipView({ forecast }: { forecast: GameForecast }) {
  return (
    <>
      <dd>
        <span className="sticker inline-flex items-center gap-2 tabular-nums">
          <span aria-hidden="true">{icon(forecast)}</span>
          {forecast.temperatureF}°F · {forecast.precipChance}% chance of rain
        </span>
      </dd>
      <dd className="text-small text-text-muted">
        {forecast.summary}. Forecast from the National Weather Service.
      </dd>
    </>
  );
}

/**
 * The forecast for an upcoming game: temperature at kickoff and the highest
 * chance of rain while it is on. Renders nothing when the forecast does not
 * reach the game yet or cannot be had; wrap it in Suspense so the rest of
 * the page never waits for it.
 */
export async function ForecastChip({
  lat,
  lng,
  startsAt,
  endsAt,
}: {
  lat: number;
  lng: number;
  startsAt: Date;
  endsAt: Date;
}) {
  const hours = await cachedForecast(lat, lng);
  const forecast = hours ? gameForecast(hours, { startsAt, endsAt }) : null;
  return forecast ? <ForecastChipView forecast={forecast} /> : null;
}
