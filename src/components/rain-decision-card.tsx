import { db } from "@/db/client";
import type { ParkGames } from "@/db/queries/rainout-decision";
import { kickoff, shortDay } from "@/domain/schedule/format";
import {
  type Decision,
  hourWords,
  inches,
  type RainFallen,
} from "@/domain/weather/decision";
import {
  type ParkWeather,
  parkDecision,
  parkWeather,
  type Reading,
} from "@/lib/park-weather";

type Stamp = Pick<Reading<unknown>, "fetchedAt" | "live">;

/**
 * The rain-out decision card (ADR 0048): for each park a game day uses,
 * what its own NWS grid point and nearest station say, read into one
 * sentence, with when each number was fetched. While NWS is down it says
 * so and shows the last data saved. Server-rendered; the rain-out screen
 * and the game-day command center stream it in its own Suspense boundary.
 */
export async function RainDecisionCard({
  parks,
  timeZone,
  headingLevel = 2,
}: {
  parks: readonly ParkGames[];
  timeZone: string;
  headingLevel?: 2 | 3;
}) {
  const now = new Date();
  if (parks.length === 0)
    return (
      <p className="text-text-muted">
        No games are still on at a park with a map pin, so there is no weather
        to show.
      </p>
    );
  const read = await Promise.all(
    parks.map(async (park) => {
      const weather = await parkWeather(db, park.lat, park.lng, now);
      return {
        park,
        weather,
        decision: parkDecision(weather, park.games, now, timeZone),
      };
    }),
  );
  return (
    <>
      {read.map(({ park, weather, decision }) => (
        <ParkCard
          key={park.venue}
          title={
            parks.length > 1 ? `Rain-out call: ${park.venue}` : "Rain-out call"
          }
          headingLevel={headingLevel}
          venue={park.venue}
          weather={weather}
          decision={decision}
          timeZone={timeZone}
          now={now}
        />
      ))}
    </>
  );
}

/** Space the card takes while it loads, so nothing below it jumps. */
export function RainDecisionCardLoading() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-72 flex-col gap-2 rounded-card border border-border bg-surface p-4"
    >
      <p className="text-text-muted">Reading the park&apos;s weather…</p>
    </div>
  );
}

const LEVEL = {
  likely: { mark: "⛈️", border: "border-danger" },
  watch: { mark: "🌧️", border: "border-warning" },
  low: { mark: "🌤️", border: "border-border" },
} as const;

/** "1:05 PM", or "Sun, Sep 13, 1:05 PM" when it was not today. */
function fetchedWords(at: Date, timeZone: string, now: Date): string {
  const time = kickoff(at, timeZone);
  return shortDay(at, timeZone) === shortDay(now, timeZone)
    ? time
    : `${shortDay(at, timeZone)}, ${time}`;
}

function ParkCard({
  title,
  headingLevel,
  venue,
  weather,
  decision,
  timeZone,
  now,
}: {
  title: string;
  headingLevel: 2 | 3;
  venue: string;
  weather: ParkWeather;
  decision: Decision;
  timeZone: string;
  now: Date;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const id = `rain-call-${venue.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const level = LEVEL[decision.level];
  const saved = [weather.forecast, weather.observed, weather.alerts].some(
    (r) => r !== null && !r.live,
  );
  const observed = weather.observed;
  const sources: { name: string; reading: Stamp }[] = [];
  if (weather.forecast)
    sources.push({ name: "Forecast", reading: weather.forecast });
  if (observed)
    sources.push({
      name: `Rain gauge (${observed.value.station.name})`,
      reading: observed,
    });
  if (weather.alerts) sources.push({ name: "Alerts", reading: weather.alerts });

  return (
    <section
      aria-labelledby={id}
      className={`flex flex-col gap-3 rounded-card border-2 ${level.border} bg-surface p-4`}
    >
      <Heading id={id} className="text-h3">
        {title}
      </Heading>
      <p className="flex gap-2">
        <span aria-hidden="true">{level.mark}</span>
        <strong>{decision.summary}</strong>
      </p>
      {weather.down && (
        <p role="status" className="rounded-lg border border-warning p-3">
          The National Weather Service isn&apos;t answering right now.{" "}
          {saved
            ? "Showing the last data saved; the times below say how old it is."
            : sources.length > 0
              ? "Some parts are missing below."
              : "No data has been saved for this park yet."}
        </p>
      )}

      {decision.hours.length > 0 && (
        <table className="w-full text-left tabular-nums">
          <caption className="text-left text-small text-text-muted">
            Game hours at {venue}
          </caption>
          <thead className="text-small text-text-muted">
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">Rain chance</th>
              <th scope="col">Rainfall</th>
              <th scope="col">Thunder</th>
            </tr>
          </thead>
          <tbody>
            {decision.hours.map((h) => (
              <tr
                key={h.startsAt.toISOString()}
                className="border-t border-border"
              >
                <th scope="row" className="font-normal">
                  {hourWords(h.startsAt, timeZone)}
                </th>
                <td>{h.chance}%</td>
                <td>{h.rainIn >= 0.005 ? `${inches(h.rainIn)} in` : "None"}</td>
                <td>{h.thunder ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {decision.near && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>Rain in the last 24 hours</dt>
          <dd className="tabular-nums">
            {fallenWords(decision.observed?.last24)}
          </dd>
          <dt>Rain in the last 48 hours</dt>
          <dd className="tabular-nums">
            {fallenWords(decision.observed?.last48)}
          </dd>
          <dt>Weather alerts</dt>
          <dd>
            {weather.alerts === null
              ? "Unknown"
              : decision.hazards.length === 0
                ? "None that affect play"
                : decision.hazards
                    .map((a) =>
                      a.endsAt
                        ? `${a.event} until ${hourWords(a.endsAt, timeZone)}`
                        : a.event,
                    )
                    .join("; ")}
          </dd>
        </dl>
      )}

      <p className="text-small text-text-muted">
        National Weather Service, for this park&apos;s own forecast square.{" "}
        {sources
          .map(
            ({ name, reading }) =>
              `${name} ${reading.live ? "fetched" : "last fetched"} ${fetchedWords(
                reading.fetchedAt,
                timeZone,
                now,
              )}`,
          )
          .join(" · ")}
      </p>
    </section>
  );
}

/** "0.6 in", or why there is no figure. */
function fallenWords(fallen: RainFallen | null | undefined): string {
  if (fallen === undefined) return "Unknown";
  if (fallen === null) return "No reports";
  const partial =
    fallen.hoursReported < fallen.hours * 0.75
      ? ` (${fallen.hoursReported} of ${fallen.hours} hours reported)`
      : "";
  return `${inches(fallen.inches)} in${partial}`;
}
