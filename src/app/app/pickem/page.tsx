import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { type DayGame, pickemPage } from "@/db/queries/pickem";
import {
  dayLabel,
  placeLabel,
  type RankedRow,
  readDay,
} from "@/domain/pickem/pickem";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { savePicksAction, setHiddenAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Pick'em" };

export default function PickemPage(props: PageProps<"/app/pickem">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading pick&apos;em…</p>}>
        <Pickem {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by code; an unknown code from the URL finds nothing. */
const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Picks saved. Good luck!" },
  locked: {
    ok: false,
    text: "Some games started before you saved, so those picks weren't taken. The rest are saved.",
  },
  own_team: {
    ok: false,
    text: "The league keeps your own team's games off your card, so those picks weren't taken.",
  },
  not_found: {
    ok: false,
    text: "One of those games is gone. Check your picks.",
  },
  empty: { ok: false, text: "Pick a winner for at least one game first." },
  hidden: { ok: true, text: "You're off the leaderboards." },
  shown: { ok: true, text: "You're back on the leaderboards." },
};

/** Players shown on a leaderboard, plus the viewer if they're further down. */
const BOARD_SIZE = 25;

function GameCard({
  game,
  timeZone,
  ownGamesAllowed,
}: {
  game: DayGame;
  timeZone: string;
  ownGamesAllowed: boolean;
}) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(game.startsAt);
  const picked =
    game.myPick === game.teamAId
      ? game.teamAName
      : game.myPick === game.teamBId
        ? game.teamBName
        : null;
  const title = `${game.teamAName} vs ${game.teamBName}`;
  const offCard = game.mine && !ownGamesAllowed;
  if (game.locked || offCard)
    return (
      <li className="flex flex-col gap-1 rounded-lg border border-border p-4">
        <strong>{title}</strong>
        <span className="text-small text-text-muted">
          {offCard && !game.locked
            ? "Your team's game: the league keeps it off your card."
            : `Locked at ${time}.`}{" "}
          {picked ? `Your pick: ${picked}.` : offCard ? "" : "No pick."}
        </span>
      </li>
    );
  return (
    <li>
      <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <legend className="px-1 font-bold">{title}</legend>
        <p className="text-small text-text-muted">
          {time}. Picks lock when it starts.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            [game.teamAId, game.teamAName],
            [game.teamBId, game.teamBName],
          ].map(([id, name]) => (
            <label
              key={id}
              className="has-[:checked]:border-primary flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <input
                type="radio"
                name={`pick:${game.id}`}
                value={id}
                defaultChecked={game.myPick === id}
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
    </li>
  );
}

function Board({
  id,
  title,
  rows,
  me,
}: {
  id: string;
  title: string;
  rows: readonly RankedRow[];
  me: string;
}) {
  const shown = rows.slice(0, BOARD_SIZE);
  const mine = rows.find((r) => r.userId === me);
  if (mine && !shown.includes(mine)) shown.push(mine);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-h3">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-text-muted">No picks scored yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-small text-text-muted">
              <th scope="col" className="py-1 pr-2">
                Place
              </th>
              <th scope="col" className="py-1 pr-2">
                Player
              </th>
              <th scope="col" className="py-1 text-right">
                Correct
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.userId}
                className={`border-t border-border ${r.userId === me ? "font-bold" : ""}`}
              >
                <td className="py-2 pr-2">{placeLabel(r, rows)}</td>
                <td className="py-2 pr-2">
                  {r.name}
                  {r.userId === me && " (you)"}
                </td>
                <td className="py-2 text-right">
                  {r.correct} of {r.scored}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function Pickem({ searchParams }: PageProps<"/app/pickem">) {
  await requireFeature("pickem");
  const query = await searchParams;
  const subject = await requirePermission("pickem.pick", {
    next: "/app/pickem",
  });
  const page = await pickemPage(
    db,
    subject.userId,
    new Date(),
    readDay(query.day),
  );
  const message =
    typeof query.notice === "string" ? MESSAGES[query.notice] : undefined;
  const open = page.coming?.games.some(
    (g) => !g.locked && (page.ownGamesAllowed || !g.mine),
  );

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Home
        </Link>
        <h1 className="text-h1">Pick&apos;em</h1>
        <p className="text-text-muted">
          Pick the winner of each game on the coming game day. You can change a
          pick until that game starts. Right picks count once the score is
          confirmed; forfeits, ties and rain-outs don&apos;t count for anyone.
        </p>
        <p className="rounded-lg border border-border bg-surface p-3">
          <strong>Just for bragging rights.</strong> Pick&apos;em is free: no
          money, no entry fee, no bets and no prizes.
        </p>
      </header>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg border p-3 ${message.ok ? "border-success" : "border-danger"}`}
        >
          {message.text}
        </p>
      )}

      <section
        id="coming"
        aria-labelledby="coming-title"
        className="flex flex-col gap-3"
      >
        <h2 id="coming-title" className="text-h2">
          {page.coming
            ? `Next game day: ${dayLabel(page.coming.day)}`
            : "Next game day"}
        </h2>
        {!page.coming || !page.season ? (
          <p className="text-text-muted">
            No games are open for picks right now. Check back when the next game
            day is on the schedule.
          </p>
        ) : (
          <form action={savePicksAction} className="flex flex-col gap-3">
            <ul className="flex flex-col gap-3">
              {page.coming.games.map((g) => (
                <GameCard
                  key={g.id}
                  game={g}
                  timeZone={page.season?.timeZone ?? "America/New_York"}
                  ownGamesAllowed={page.ownGamesAllowed}
                />
              ))}
            </ul>
            {open && (
              <SubmitButton className="btn self-start btn-primary">
                Save picks
              </SubmitButton>
            )}
          </form>
        )}
      </section>

      <section
        id="you"
        aria-labelledby="you-title"
        className="flex flex-col gap-2"
      >
        <h2 id="you-title" className="text-h2">
          Your season
        </h2>
        <p>
          {page.me.scored === 0
            ? page.me.picks === 0
              ? "No picks yet this season."
              : "None of your picks has been scored yet."
            : `${page.me.correct} of ${page.me.scored} scored picks right.`}
        </p>
        <p className="text-text-muted">
          {page.hidden
            ? "You're hidden from the leaderboards. Only you see your record."
            : "You're on the leaderboards. You can hide yourself at any time."}
        </p>
        <form action={setHiddenAction.bind(null, !page.hidden)}>
          <SubmitButton className="btn btn-secondary">
            {page.hidden
              ? "Show me on the leaderboards"
              : "Hide me from the leaderboards"}
          </SubmitButton>
        </form>
      </section>

      <section aria-labelledby="boards" className="flex flex-col gap-4">
        <h2 id="boards" className="text-h2">
          Leaderboards
        </h2>
        <p className="text-text-muted">
          Ranked by right picks. Players with the same number share a place.
        </p>
        <Board
          id="board-season"
          title={page.season ? `${page.season.name} season` : "Season"}
          rows={page.seasonBoard}
          me={subject.userId}
        />
        {page.day && (
          <Board
            id="board-day"
            title={`Game day: ${dayLabel(page.day)}`}
            rows={page.dayBoard}
            me={subject.userId}
          />
        )}
        {page.scoredDays.length > 1 && (
          <nav aria-label="Other game days">
            <ul className="flex flex-wrap gap-2">
              {page.scoredDays.map((d) => (
                <li key={d}>
                  <Link
                    href={`/app/pickem?day=${d}#board-day`}
                    aria-current={d === page.day ? "page" : undefined}
                    className="btn btn-secondary"
                  >
                    {dayLabel(d)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>
    </>
  );
}
