import {
  type GameForecast,
  gameForecast,
  WATCH_AT,
} from "@/domain/weather/forecast";
import { featureEnabled } from "@/lib/platform/site";
import { cachedForecast } from "@/lib/weather";

const icon = (f: GameForecast) =>
  f.thunder
    ? "⛈️"
    : f.precipChance >= WATCH_AT
      ? "🌧️"
      : f.precipChance >= 20
        ? "🌦️"
        : "🌤️";

/** The two lines the forecast takes in a game page's "When" card. */
function ForecastLines({
  icon,
  headline,
  note,
  hidden = false,
}: {
  icon: string;
  headline: string;
  note: string;
  hidden?: boolean;
}) {
  // Hidden lines keep their space but are neither seen nor read out.
  const hide = hidden ? { "aria-hidden": true } : {};
  return (
    <>
      <dd {...hide} className={hidden ? "invisible" : undefined}>
        <span className="sticker inline-flex items-center gap-2 tabular-nums">
          <span aria-hidden="true">{icon}</span>
          {headline}
        </span>
      </dd>
      <dd
        {...hide}
        className={`text-small text-text-muted ${hidden ? "invisible" : ""}`}
      >
        {note}
      </dd>
    </>
  );
}

/** The forecast line inside a game page's "When" card, as dd items. */
export function ForecastChipView({ forecast }: { forecast: GameForecast }) {
  return (
    <ForecastLines
      icon={icon(forecast)}
      headline={`${forecast.temperatureF}°F · ${forecast.precipChance}% chance of rain`}
      note={`${forecast.summary}. Forecast from the National Weather Service.`}
    />
  );
}

/**
 * The forecast's space while it loads: the same lines, hidden, so nothing
 * below them moves when the forecast arrives (issue #495).
 */
export function ForecastSpace() {
  return (
    <ForecastLines
      icon="🌤️"
      headline="70°F · 10% chance of rain"
      note="Partly sunny. Forecast from the National Weather Service."
      hidden
    />
  );
}

/**
 * The forecast for an upcoming game: temperature at kickoff and the highest
 * chance of rain while it is on. Wrap it in Suspense with `ForecastSpace` as
 * the fallback, so the rest of the page never waits for it or moves. When
 * the forecast does not reach the game yet or cannot be had, it says so in
 * the same space; with weather switched off, the space stays empty.
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
  if (!(await featureEnabled("weather"))) return <ForecastSpace />;
  const hours = await cachedForecast(lat, lng);
  const forecast = hours ? gameForecast(hours, { startsAt, endsAt }) : null;
  return forecast ? (
    <ForecastChipView forecast={forecast} />
  ) : (
    <ForecastLines
      icon="🌤️"
      headline="No forecast yet"
      note="Forecasts reach a week ahead."
    />
  );
}
