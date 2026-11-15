import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import parkFields from "@/domain/capacity/nyc-park-fields.json";
import { db } from "@/db/client";
import { capacityInputs } from "@/db/queries/capacity";
import {
  boroughName,
  milesText,
  nearbyFields,
  type ParkField,
} from "@/domain/capacity/nearby";
import {
  buildPlan,
  MAX_GAME_MINUTES,
  MAX_GAMES_PER_TEAM,
  MAX_TEAMS,
  MIN_GAME_MINUTES,
  type PlanOption,
} from "@/domain/capacity/plan";
import { HOME_PARK } from "@/lib/site";
import { requirePermission } from "@/lib/auth/permission";
import { booksSeason } from "../../../load";
import { SeasonPicker } from "../../../season-picker";
import { NYC_PARKS_LINKS } from "../nyc-parks-panel";
import { WEEKDAYS } from "../request";
import { planChoices, requestHref } from "./choices";

export const metadata: Metadata = { title: "Capacity planner" };

export default function CapacityPage(
  props: PageProps<"/app/books/[season]/permits/capacity">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PlannerSkeleton />}>
        <Planner {...props} />
      </Suspense>
    </main>
  );
}

/** Holds the planner's space while it loads, so nothing jumps. */
function PlannerSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <p className="sr-only">Loading…</p>
      <div className="h-40 rounded-lg bg-surface-2" />
      <div className="h-96 rounded-lg bg-surface-2" />
    </div>
  );
}

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

/** "18:30" → "6:30 pm". */
function time(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "am" : "pm";
  return m === 0
    ? `${hour} ${suffix}`
    : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const hours = (n: number) =>
  `${Number.isInteger(n) ? n : n.toFixed(1)} field ${n === 1 ? "hour" : "hours"}`;

function describe(
  o: PlanOption,
  current: { gameMinutes: number; gamesPerTeam: number },
): { title: string; detail: string } {
  const day = o.weekday === undefined ? "" : WEEKDAYS[o.weekday];
  const span = o.first && o.last ? `${time(o.first)} to ${time(o.last)}` : "";
  switch (o.kind) {
    case "shorter_games":
      return {
        title: `${o.gameMinutes}-minute games instead of ${current.gameMinutes}`,
        detail:
          "Shorter games or tighter changeovers fit more games into the field time you already hold. No new permit hours.",
      };
    case "doubleheaders":
      return {
        title: "Doubleheaders",
        detail:
          "Each team plays two games back to back on a game day, so every slot you hold can be used. No new permit hours.",
      };
    case "extra_weeknight":
      return {
        title: `Add ${day} nights`,
        detail: `${o.fieldName}, ${span}, every ${day} of the season, shared by every team.`,
      };
    case "weekend_daytime":
      return {
        title: `Add ${day} daytime`,
        detail: `${o.fieldName}, ${span}, every ${day} of the season.`,
      };
    case "more_fields":
      return {
        title: "One more field",
        detail: `${o.fieldName} at the same times as your usual ${day} permit, ${span}.`,
      };
    case "divisions":
      return {
        title: "Two divisions on different nights",
        detail: `Keep your field time for one division and give a second division its own ${day} night, ${span} on ${o.fieldName}. Teams play within their division.`,
      };
    case "shorter_season":
      return {
        title: `${o.gamesPerTeam} games a team instead of ${current.gamesPerTeam}`,
        detail: "A shorter season needs fewer games. No new permit hours.",
      };
  }
}

async function Planner({
  params,
  searchParams,
}: PageProps<"/app/books/[season]/permits/capacity">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}/permits/capacity`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season, seasons } = await booksSeason(slug);
  const inputs = await capacityInputs(
    db,
    league.id,
    season.id,
    league.timeZone,
  );
  const gamesPerTeamPerDay = season.gamesPerTeamPerDay === 2 ? 2 : 1;
  const choices = planChoices(query, {
    ...inputs,
    gamesPerTeamPerDay,
  });
  const used = inputs.fields.filter((f) => f.windows > 0);
  const named = (f: (typeof inputs.fields)[number]) =>
    `${f.venueName}, ${f.name}`;
  const main = used[0];
  const spare = inputs.fields.find((f) => f.windows === 0);
  const plan = buildPlan({
    season,
    windows: inputs.windows,
    blackouts: inputs.blackouts,
    gameMinutes: choices.gameMinutes,
    gamesPerTeam: choices.gamesPerTeam,
    gamesPerTeamPerDay,
    wanted: choices.wanted,
    mainField: main ? { id: main.id, name: named(main) } : undefined,
    spareField: spare ? { id: spare.id, name: named(spare) } : undefined,
  });
  const fromDefaults =
    choices.wanted === Math.min(MAX_TEAMS, inputs.entered + inputs.waiting);
  const parks =
    inputs.parks.length > 0
      ? inputs.parks
      : [{ lat: HOME_PARK.geo.latitude, lng: HOME_PARK.geo.longitude }];
  const nearby = nearbyFields(parkFields.fields as ParkField[], parks);
  const options = [...plan.options].sort((a, b) => b.extraTeams - a.extraTeams);
  const fetchedOn = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${parkFields.fetchedOn}T12:00:00Z`));

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/books/${slug}/permits`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Permits: {season.name}
        </Link>
        <h1 className="text-h1">Capacity planner</h1>
        <p className="text-text-muted">
          How many teams the field time you hold for {season.name} can fit, how
          many want to play, and what would make room for the rest.
        </p>
        <SeasonPicker
          seasons={seasons}
          current={season.slug}
          path={(s) => `/app/books/${s}/permits/capacity`}
        />
      </header>

      <form method="get" action={page} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-small">Game length (minutes)</span>
            <input
              type="number"
              name="minutes"
              min={MIN_GAME_MINUTES}
              max={MAX_GAME_MINUTES}
              defaultValue={choices.gameMinutes}
              className={`${input} w-28`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small">Games per team</span>
            <input
              type="number"
              name="games"
              min={1}
              max={MAX_GAMES_PER_TEAM}
              defaultValue={choices.gamesPerTeam}
              className={`${input} w-28`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small">Teams that want to play</span>
            <input
              type="number"
              name="want"
              min={0}
              max={MAX_TEAMS}
              defaultValue={choices.wanted}
              className={`${input} w-28`}
            />
          </label>
        </div>
        <button type="submit" className="btn self-start btn-secondary">
          Work it out
        </button>
      </form>

      <section aria-labelledby="fit" className="flex flex-col gap-3">
        <h2 id="fit" className="text-h2">
          {inputs.windows.length === 0
            ? "No field time yet"
            : `The field time you hold fits ${plural(plan.capacity.teams, "team")}`}
        </h2>
        {inputs.windows.length === 0 ? (
          <p className="text-text-muted">
            Add this season&rsquo;s permit windows on the{" "}
            <Link
              href={`/app/admin/seasons/${slug}/fields`}
              className="underline"
            >
              fields screen
            </Link>{" "}
            and the planner works out how many teams they fit.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-text-muted">Game days</dt>
            <dd>{plan.capacity.gameDays}</dd>
            <dt className="text-text-muted">Field time</dt>
            <dd>{hours(plan.capacity.fieldHours)}</dd>
            <dt className="text-text-muted">Games it holds</dt>
            <dd>
              {plural(plan.capacity.slots, "game")} of {choices.gameMinutes}{" "}
              minutes
            </dd>
            <dt className="text-text-muted">Each team plays</dt>
            <dd>
              {plural(choices.gamesPerTeam, "game")}
              {gamesPerTeamPerDay === 2 ? ", two a game day" : ""}
            </dd>
          </dl>
        )}
        <p>
          {plural(plan.wanted, "team")} want to play
          {fromDefaults
            ? `: ${plural(inputs.entered, "team")} in the season and ${inputs.waiting} waiting for a place.`
            : "."}
        </p>
        {plan.gap > 0 ? (
          <p
            role="status"
            className="rounded-lg border-2 border-warning p-3 font-semibold"
          >
            {plural(plan.gap, "team")} {plan.gap === 1 ? "doesn't" : "don't"}{" "}
            fit
            {plan.gamesShort > 0
              ? `: the season is ${plural(plan.gamesShort, "game")} short.`
              : "."}
          </p>
        ) : (
          plan.wanted > 0 && (
            <p role="status" className="rounded-lg border border-success p-3">
              Every team that wants to play fits
              {plan.capacity.teams > plan.wanted
                ? `, with room for ${plural(plan.capacity.teams - plan.wanted, "more team")}.`
                : "."}
            </p>
          )
        )}
      </section>

      {inputs.windows.length > 0 && (
        <section aria-labelledby="options" className="flex flex-col gap-4">
          <h2 id="options" className="text-h2">
            Ways to make room
          </h2>
          <p className="text-text-muted">
            Each option on its own, with the most teams the season fits with it.
            Options that add field time link to the request sheet with just the
            extra games you need.
          </p>
          <ul className="flex flex-col gap-3">
            {options.map((o) => {
              const { title, detail } = describe(o, choices);
              return (
                <li
                  key={o.kind}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4"
                >
                  <h3 className="text-h3">{title}</h3>
                  <p>
                    <strong>
                      {o.extraTeams > 0
                        ? `+${plural(o.extraTeams, "team")}`
                        : "No extra teams"}
                    </strong>{" "}
                    <span className="text-text-muted">
                      (fits {plural(o.teams, "team")}
                      {o.closesGap && plan.gap > 0
                        ? ", enough for everyone"
                        : ""}
                      )
                    </span>
                  </p>
                  <p className="text-small">{detail}</p>
                  {o.needsLights && (
                    <p className="text-small">
                      Needs a lit field in the fall: it&rsquo;s dark by about
                      6:40 pm at the end of September.
                    </p>
                  )}
                  {o.request && (
                    <div className="flex flex-col gap-2 border-t border-border pt-2">
                      <p className="text-small">
                        For the teams waiting, ask for{" "}
                        <strong>{hours(o.request.fieldHours)}</strong>:{" "}
                        {plural(o.request.gamesPerDay, "game")} each{" "}
                        {WEEKDAYS[o.request.weekday]} on {o.request.dates}{" "}
                        {o.request.dates === 1 ? "date" : "dates"}
                        {o.request.games < plan.gamesShort
                          ? `, ${o.request.games} of the ${plan.gamesShort} games short`
                          : ""}
                        .
                      </p>
                      <Link
                        href={requestHref(slug, o.request)}
                        className="btn self-start btn-primary"
                      >
                        Put it on the request sheet
                        <span className="sr-only">: {title}</span>
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="nearby" className="flex flex-col gap-4">
        <h2 id="nearby" className="text-h2">
          Fields to apply for nearby
        </h2>
        <p className="text-text-muted">
          NYC Parks softball and baseball diamonds and large multi-use fields
          within about 3 miles of your parks, nearest first. In the fall, NYC
          Parks gives multi-use fields to soccer and football first, so diamonds
          are the better bet. Check what&rsquo;s free on the{" "}
          <a href={NYC_PARKS_LINKS.map} className="underline">
            field availability map
          </a>
          .
        </p>
        {nearby.length === 0 ? (
          <p className="text-text-muted">No suitable fields nearby.</p>
        ) : (
          <ul className="flex flex-col">
            {nearby.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-2"
              >
                <span>
                  {f.park}, {f.label}
                  <span className="block text-small text-text-muted">
                    {f.kind === "diamond" ? "Diamond" : "Large multi-use field"}
                    {" · "}
                    {f.surface}
                    {f.lit ? " · lights" : ""}
                    {f.kickball ? " · kickball permitted" : ""}
                    {" · "}
                    {boroughName(f.borough)}
                  </span>
                </span>
                <span className="whitespace-nowrap">{milesText(f.km)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-small text-text-muted">
          From NYC Open Data&rsquo;s{" "}
          <a href={parkFields.sourceUrl} className="underline">
            Athletic Facilities
          </a>{" "}
          dataset (NYC Parks), as of {fetchedOn}.
        </p>
      </section>
    </>
  );
}
