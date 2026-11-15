import {
  type GameForecast,
  gameForecast,
  WATCH_AT,
} from "@/domain/weather/forecast";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
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
export function ForecastChipView({
  forecast,
  locale = DEFAULT_LOCALE,
}: {
  forecast: GameForecast;
  /** The page's language (ADR 0094); English unless given. */
  locale?: Locale;
}) {
  const words = messagesFor(locale).game;
  return (
    <ForecastLines
      icon={icon(forecast)}
      headline={fill(words.forecast, {
        temperature: forecast.temperatureF,
        chance: forecast.precipChance,
      })}
      note={fill(words.forecastSource, { summary: forecast.summary })}
    />
  );
}

/**
 * The forecast's space while it loads: the same lines, hidden, so nothing
 * below them moves when the forecast arrives (issue #495).
 */
export function ForecastSpace({
  locale = DEFAULT_LOCALE,
}: {
  locale?: Locale;
} = {}) {
  const words = messagesFor(locale).game;
  return (
    <ForecastLines
      icon="🌤️"
      headline={fill(words.forecast, { temperature: 70, chance: 10 })}
      note={fill(words.forecastSource, { summary: "Partly sunny" })}
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
  locale = DEFAULT_LOCALE,
}: {
  lat: number;
  lng: number;
  startsAt: Date;
  endsAt: Date;
  locale?: Locale;
}) {
  if (!(await featureEnabled("weather")))
    return <ForecastSpace locale={locale} />;
  const hours = await cachedForecast(lat, lng);
  const forecast = hours ? gameForecast(hours, { startsAt, endsAt }) : null;
  const words = messagesFor(locale).game;
  return forecast ? (
    <ForecastChipView forecast={forecast} locale={locale} />
  ) : (
    <ForecastLines
      icon="🌤️"
      headline={words.noForecast}
      note={words.noForecastNote}
    />
  );
}
