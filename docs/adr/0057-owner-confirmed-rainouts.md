# ADR 0057: Owners confirm rain-outs, from a decision card on the park's own weather

- Status: accepted
- Date: 2026-11-14

## Context

Calling a rain-out cancels a whole game day: every team on it loses its night out, makeups take reserve slots, and players get emails. Until now any admin could do it from the rain-out screen, and the only weather they saw was the chance of rain over the game hours. The league wants the call made by an owner, never by the software on its own, with the best information about that park, and ideally about 3 to 4 hours before first pitch.

Two things decide whether a kickball field is playable: the weather during the games and the state of the ground. A field soaked overnight can be unplayable at a dry 6 pm. The National Weather Service ([ADR 0005](0005-weather-forecast-source.md)) publishes all of it for free and without a key: the grid square's raw forecast (expected rainfall, chance of thunder), what nearby stations measured, and active alerts for a point. Open-Meteo is not an option, because its free tier is non-commercial ([ADR 0021](0021-free-services-only.md)).

Vercel Hobby runs each cron entry at most once a day, somewhere within the hour it names. The league plays at different times by season: summer Sundays around 2 pm, spring and fall weeknights around 7 to 8 pm.

## Decision

**Owners confirm.** Confirming a rain-out (`rainout.confirm`) belongs to the owners and the platform operator. Admins keep everything else (`rainout.prepare`): they open the screen, read the card, preview the makeups and send the day to the owners, who each get an urgent `rainout_request` linking back to it. The screen shows who sent it and when. An owners-only league setting, `league.admins_confirm_rainouts`, lets admins confirm too, for days no owner is around. The rule is in the one permissions function, with the setting passed in as context, and every send, confirm and setting change is audited. Nothing is ever cancelled automatically; the most the software does is alert.

**A decision card for each park.** `src/domain/weather/decision.ts` reads the park's own grid point into a level (low, watch, likely) and one sentence: the chance of rain, rainfall and thunder for each game hour; rain the nearest station measured in the last 24 hours plus rain due before first pitch (half an inch puts the day on watch, an inch makes it likely); and alerts in effect (a storm, flood or wind warning is likely, a watch or advisory is watch). Measured rain and alerts count only when first pitch is within a day and a half. The card shows when each part was fetched.

**The last good answer is kept.** Pages read NWS through the data cache. Each fresh part (forecast, measured rain, alerts) is also saved to `weather_snapshot`, one row per park and part, replaced only by a newer answer. While NWS does not answer, the card says so and shows the saved part with its time instead of failing. The data cache alone would lose this on a new deploy or a cold serverless instance, exactly when it is needed.

**A decision-time alert, twice a day.** `/api/jobs/rain-decision` runs at 13:00 and 18:00 UTC (9 am and 2 pm in summer). Each run takes game days whose first pitch is 2 to 8 hours away, and on watch or likely sends the worst park's sentence to everyone who confirms (owners, and admins when allowed), once per game day. The morning run lands 4 to 5 hours before a 2 pm start; the afternoon run 4 to 6 hours before an evening one.

## Alternatives considered

- **Cancel automatically on "likely".** Rejected: the call depends on things no forecast knows (the park's drainage, a permit office closure, whether teams would rather play wet), and an automatic cancellation that turns out wrong costs a whole night.
- **A pending rain-out table, with confirm as a state change.** It would give a request its own lifecycle (withdrawn, expired). The audit row and the owners' messages already say who asked and when, and the confirm itself is the existing cancel-and-draft step, so no new state is needed yet.
- **One cron entry.** One fixed hour can't be 4 to 5 hours before both a 2 pm and an 8 pm start. Hobby allows a job once a day per entry, so two entries with the same path cover both; a league with very different start times would add a third.
- **Hourly polling.** Not possible on Hobby, and it would spend NWS requests and outbox work on hours with no games.
- **Use only the hourly forecast.** It has no rainfall amounts and nothing about rain already on the ground, which is what most often decides a soaked field.

## Consequences

- An admin alone on a game day with no owner reachable can't cancel unless the owners turned the setting on beforehand. The setting is on the rain-out screen, where an owner sees it.
- One new table and one league column (migration `0055`). The table holds no personal data.
- NWS requests grow to a few hundred a day for one park, well within its unpublished limit (architecture section 15).
- Station reports can be missing or late; the card says how many hours a station reported when it is fewer than three in four, and a missing gauge never stops the forecast and alerts from showing.
- The thresholds are constants. Per-season thresholds remain planned (architecture section 7).
