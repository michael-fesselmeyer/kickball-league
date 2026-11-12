# ADR 0005: The National Weather Service for forecasts, held in the data cache

- Status: accepted
- Date: 2026-11-12

## Context

The league plays outdoors in a Brooklyn park, and rain decides more game days than anything else. Players want the forecast on the game page, and admins want a nudge the day before when a rain-out is worth considering. The source has to be free, need no API key (nothing to rotate or leak in a public repository), allow use by a league that charges registration fees, and cover New York City. A page view must never wait on it, and tests must not reach the network.

`docs/architecture.md` (section 7) planned the National Weather Service (NWS) with Open-Meteo as a fallback, and a `weather_snapshot` table so pages never call the API.

## Decision

**The NWS API (`api.weather.gov`) is the only source for now.** Its data is a United States government work: public domain, free, and open to commercial use. It needs no key. Its terms ask every caller to send a `User-Agent` that identifies the application and how to reach whoever runs it; ours is `kickball-league (<site address>)`, the site's public address and no personal details. The client (`src/services/weather.ts`) makes two requests: the point lookup, which names the forecast office's grid square, then that square's hourly forecast. Every answer is checked with a schema, each request gives up after four seconds, and a failure is a value, never an exception that reaches a page.

**Forecasts are held in the Next.js data cache, not a table.** `src/lib/weather.ts` wraps both requests in `'use cache'` functions: the grid square for weeks (it moves only when the office redraws its grid), the hourly forecast with the `hours` profile (served from cache for an hour, then refreshed in the background on the next read). A failed lookup throws inside the cached function so it is not stored, and reaches callers as "no forecast". The game page streams the forecast chip in its own Suspense boundary, so the rest of the page renders first even on a cold cache. The rain-alert job reads through the same functions.

**Alerts use the outbox, not new storage.** The alert's dedupe key, `rain-alert/<season>/<date>/<level>/<admin>`, is what makes "at most once per game day per level" hold, so the feature needs no schema change.

**The risk rule is a pure function** in `src/domain/weather/forecast.ts`, over the hours games are on: likely at 70% chance of rain or thunderstorms in any game hour, watch at 40 to 69%, low otherwise.

## Alternatives considered

- **Open-Meteo.** Keyless and global, but its free tier is for non-commercial use, and the league takes fees. It stays the planned fallback behind the same client shape if NWS outages become a problem.
- **Commercial APIs (OpenWeather, Tomorrow.io, WeatherAPI).** They need keys and an account, and their free tiers come with attribution and rate terms that change.
- **A `weather_snapshot` table, as planned.** It survives deploys and keeps a history of what the forecast said when a rain-out was called. It needs a migration, and only one open pull request may add one at a time. The data cache gives the same "pages never call the API" property now; the table can come later, when the admin dashboard wants forecast history.

## Consequences

- The forecast covers the United States only, about six and a half days ahead. Games further out show no chip.
- With the default in-memory cache handler, a serverless instance that has not seen a place yet makes the two requests once; the chip streams in late or not at all if NWS is slow, and the page does not wait. A new deploy starts with an empty cache. `'use cache: remote'` is the upgrade if NWS load or cold reads become a problem.
- The parts of the planned rule that need more data are not built: half an inch of rain in the 12 hours before first pitch (from the grid's quantitative precipitation) and active severe-weather alerts (from `/alerts/active`). Thresholds are constants, not season settings yet.
- Tests use a fixture in the NWS response format (`src/services/fixtures/`) and an injected `fetch`; no test touches the network.
