import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { commandDate } from "@/db/queries/command-center";
import {
  type CheckInSheet,
  packRosters,
  packRows,
} from "@/db/queries/game-day-pack";
import {
  type FieldSheet,
  PACK_INNINGS,
  type PackGame,
  permitLine,
  teamsPlaying,
  fieldSheets,
} from "@/domain/gameday/pack";
import type { TeamSeasonId } from "@/domain/ids";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { qrMatrix, qrSvgPath } from "@/lib/qr";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { parseDay } from "../load";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Game-day pack" };

/**
 * The printable game-day pack (issue #377): a sheet per field with its
 * games, a blank line score for each, both captains' initials and the
 * permit, and optionally a check-in sheet per team. Plain HTML and the
 * print styles in globals.css; the Print button is the only client code.
 */
export default function GameDayPackPage(
  props: PageProps<"/[lang]/app/admin/today/print">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 print:max-w-none print:p-0">
      <Suspense
        fallback={<PageLoading>Loading the game-day pack…</PageLoading>}
      >
        <GameDayPack {...props} />
      </Suspense>
    </main>
  );
}

async function GameDayPack({
  searchParams,
}: PageProps<"/[lang]/app/admin/today/print">) {
  await requirePermission("season.manage", {
    next: "/app/admin/today/print",
  });
  const query = await searchParams;
  const withRosters = query.rosters === "1";
  const league = await activeLeague();
  const now = new Date();
  const date = league
    ? (parseDay(query.date) ?? (await commandDate(db, league.id, now)))
    : null;
  const rows = league && date ? await packRows(db, league.id, date) : [];
  const teams = teamsPlaying(rows);
  const rosters = withRosters
    ? await packRosters(
        db,
        teams.map((t) => t.id as TeamSeasonId),
      )
    : [];
  const timeZone = league?.timeZone ?? "America/New_York";
  const dayLabel = date
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T12:00:00Z`))
    : null;
  const sheets = fieldSheets(rows);
  const origin = siteOrigin(env.BETTER_AUTH_URL);

  return (
    <>
      <header className="flex flex-col gap-3 print:hidden">
        <p className="text-text-muted">{dayLabel ?? "No game day"}</p>
        <h1 className="text-h1">Game-day pack</h1>
        <p>
          One sheet per field with each game&apos;s line score, a QR code to
          enter the score later and the field&apos;s permit. Printed in black
          and white on US Letter.
        </p>
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Choose the game day"
        >
          <label className="flex flex-col gap-1">
            <span className="font-bold">Game day</span>
            <input
              type="date"
              name="date"
              defaultValue={date ?? undefined}
              required
              className="min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="rosters"
              value="1"
              defaultChecked={withRosters}
              className="size-5"
            />
            Add a check-in sheet per team
          </label>
          <button type="submit" className="btn btn-secondary">
            Show
          </button>
        </form>
        <nav aria-label="Pack actions" className="flex flex-wrap gap-2">
          {sheets.length > 0 && <PrintButton />}
          <Link
            href={date ? `/app/admin/today?date=${date}` : "/app/admin/today"}
            className="btn btn-secondary"
          >
            Back to game day
          </Link>
        </nav>
      </header>

      {sheets.length === 0 ? (
        <p>No games on this day.</p>
      ) : (
        <div className="flex flex-col gap-8 print:block">
          {sheets.map((sheet) => (
            <FieldPage
              key={sheet.fieldId}
              sheet={sheet}
              dayLabel={dayLabel ?? ""}
              timeZone={timeZone}
              origin={origin}
            />
          ))}
          {rosters.map((roster) => (
            <RosterPage
              key={roster.teamSeasonId}
              roster={roster}
              teamName={
                teams.find((t) => t.id === roster.teamSeasonId)?.name ?? ""
              }
              dayLabel={dayLabel ?? ""}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** A printed page: a ruled card on screen, a plain US Letter page on paper. */
const PAGE =
  "flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-4 text-text print:break-after-page print:rounded-none print:border-0 print:p-0 print:last:break-after-auto";

function FieldPage({
  sheet,
  dayLabel,
  timeZone,
  origin,
}: {
  sheet: FieldSheet;
  dayLabel: string;
  timeZone: string;
  origin: string;
}) {
  const headingId = `field-${sheet.fieldId}`;
  return (
    <section aria-labelledby={headingId} className={PAGE}>
      <header className="flex flex-col gap-1 border-b-2 border-text pb-2">
        <p className="text-small">{dayLabel}</p>
        <h2 id={headingId} className="text-h2">
          {sheet.fieldName}
          <span className="text-body font-normal"> · {sheet.venueName}</span>
        </h2>
        <ul className="text-small">
          {sheet.permits.map((p) => (
            <li key={`${p.number ?? ""}-${p.status}`}>{permitLine(p)}</li>
          ))}
          {sheet.unpermitted && (
            <li>A game here has no permit recorded. Check with an admin.</li>
          )}
          <li>☐ Printed permit at the field</li>
        </ul>
      </header>
      {sheet.games.map((g) => (
        <GameBlock key={g.id} game={g} timeZone={timeZone} origin={origin} />
      ))}
    </section>
  );
}

function GameBlock({
  game,
  timeZone,
  origin,
}: {
  game: PackGame;
  timeZone: string;
  origin: string;
}) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(game.startsAt);
  const scoreUrl = absoluteUrl(origin, `/app/games/${game.id}/score`);
  const qr = qrSvgPath(qrMatrix(scoreUrl));
  const cell = "border border-text px-1 text-center";
  return (
    <article className="flex break-inside-avoid flex-col gap-2 border-b border-text pb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-h3">
            <span className="tabular-nums">{time}</span> · {game.first} vs{" "}
            {game.second}
          </h3>
          <p className="text-small">
            Ref: {game.referee ?? "not assigned"}
            {game.calledOff && " · Called off"}
          </p>
        </div>
        {!game.calledOff && (
          <figure className="flex shrink-0 flex-col items-center gap-1">
            <svg
              viewBox={qr.viewBox}
              role="img"
              aria-label={`QR code: enter the score for ${game.first} vs ${game.second}`}
              className="bg-white size-24"
              shapeRendering="crispEdges"
            >
              <path d={qr.path} fill="black" />
            </svg>
            <figcaption className="text-small">
              Scan to enter the score
            </figcaption>
          </figure>
        )}
      </div>
      {game.calledOff ? (
        <p>This game is called off: no score to keep.</p>
      ) : (
        <>
          <table className="w-full border-collapse text-small">
            <caption className="sr-only">
              Line score for {game.first} vs {game.second}, runs per half inning
            </caption>
            <thead>
              <tr>
                <th scope="col" className={`${cell} text-left`}>
                  Team
                </th>
                {PACK_INNINGS.map((i) => (
                  <th key={i} scope="col" className={`${cell} w-9`}>
                    {i}
                  </th>
                ))}
                <th scope="col" className={`${cell} w-9`}>
                  <abbr title="Extra innings">X</abbr>
                </th>
                <th scope="col" className={`${cell} w-11`}>
                  <abbr title="Runs">R</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {[game.first, game.second].map((name) => (
                <tr key={name} className="h-9">
                  <th scope="row" className={`${cell} text-left font-bold`}>
                    {name}
                  </th>
                  {[...PACK_INNINGS, "X", "R"].map((i) => (
                    <td key={i} className={cell} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="grid grid-cols-1 gap-2 text-small sm:grid-cols-3 print:grid-cols-3">
            <Blank label="Final score" />
            <Blank label={`${game.first} captain's initials`} />
            <Blank label={`${game.second} captain's initials`} />
          </dl>
        </>
      )}
    </article>
  );
}

/** A label over a full-width line to write on, however long the label. */
function Blank({ label }: { label: string }) {
  return (
    <div className="flex flex-col">
      <dt>{label}</dt>
      <dd className="h-8 border-b border-text" />
    </div>
  );
}

/** Spare lines at the foot of a check-in sheet for subs. */
const SUB_LINES = 4;

function RosterPage({
  roster,
  teamName,
  dayLabel,
}: {
  roster: CheckInSheet;
  teamName: string;
  dayLabel: string;
}) {
  const headingId = `roster-${roster.teamSeasonId}`;
  const cell = "border border-text px-2 py-1";
  return (
    <section aria-labelledby={headingId} className={PAGE}>
      <header className="flex flex-col gap-1 border-b-2 border-text pb-2">
        <p className="text-small">{dayLabel} · Check-in</p>
        <h2 id={headingId} className="text-h2">
          {teamName}
        </h2>
      </header>
      <table className="w-full border-collapse">
        <caption className="sr-only">Check-in sheet for {teamName}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${cell} w-12`}>
              Here
            </th>
            <th scope="col" className={`${cell} text-left`}>
              Player
            </th>
          </tr>
        </thead>
        <tbody>
          {roster.players.map((p, i) => (
            <tr key={`${p.name}-${i}`} className="h-9">
              <td className={`${cell} text-center`}>☐</td>
              <td className={cell}>
                {p.name}
                {p.role === "captain" && " (captain)"}
                {p.role === "co_captain" && " (co-captain)"}
              </td>
            </tr>
          ))}
          {Array.from({ length: SUB_LINES }, (_, i) => (
            <tr key={`sub-${i}`} className="h-9">
              <td className={`${cell} text-center`}>☐</td>
              <td className={`${cell} text-text-muted`}>Sub:</td>
            </tr>
          ))}
        </tbody>
      </table>
      {roster.players.length === 0 && (
        <p className="text-small">No active players on the roster.</p>
      )}
    </section>
  );
}
