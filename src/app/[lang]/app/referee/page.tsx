import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import {
  availabilityOf,
  myRefereeGames,
  payoutsOf,
  payRate,
  refereeSeasons,
  seasonGameTimes,
} from "@/db/queries/referee-pool";
import { localDate } from "@/domain/books/ledger-csv";
import { money } from "@/domain/books/ledger";
import { parseId, type SeasonId, type UserId } from "@/domain/ids";
import { DROP_REASON_MAX } from "@/domain/referees/cover";
import { PAYOUT_METHOD_LABELS, paySheet } from "@/domain/referees/pay";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { dropGameAction, saveAvailabilityAction } from "./actions";

export const metadata: Metadata = { title: "Reffing" };

const ERRORS: Record<string, string> = {
  reason: `Say why in a few words (up to ${DROP_REASON_MAX} characters).`,
  not_yours: "That game isn't yours to drop any more.",
  started: "That game has started, so it can't be dropped here. Tell an admin.",
};

export default function RefereePage(props: PageProps<"/app/referee">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading your games…</PageLoading>}>
        <Referee {...props} />
      </Suspense>
    </main>
  );
}

async function Referee({ searchParams }: PageProps<"/app/referee">) {
  const query = await searchParams;
  const subject = await requirePermission("referee.availability", {
    next: "/app/referee",
  });
  const userId = parseId<UserId>(subject.userId);
  const league = await activeLeague();
  if (!userId || !league) notFound();
  const now = new Date();
  const seasons = await refereeSeasons(db, {
    leagueId: league.id,
    userId,
    now,
  });

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app" className="underline">
          Home
        </Link>
        <h1 className="text-h1">Reffing</h1>
        <p className="text-text-muted">
          Tick the game times you can work, and admins will only ask you for
          those. You&rsquo;ll never be asked to ref a game your own team plays.
        </p>
      </header>
      {typeof query.dropped === "string" && (
        <p role="status" className="rounded-lg border border-success p-3">
          You&rsquo;re off that game.{" "}
          {query.dropped === "0"
            ? "Admins can see it needs a ref."
            : `We asked ${query.dropped === "1" ? "1 other ref" : `${query.dropped} other refs`} to take it.`}
        </p>
      )}
      {typeof query.error === "string" && ERRORS[query.error] && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {ERRORS[query.error]}
        </p>
      )}
      {query.saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          Saved. Thanks!
        </p>
      )}
      {seasons.length === 0 && (
        <p className="text-text-muted">No season has games coming up yet.</p>
      )}
      {seasons.map((s) => (
        <SeasonBlock
          key={s.id}
          season={{ id: s.id, name: s.name }}
          userId={userId}
          timeZone={league.timeZone}
          now={now}
        />
      ))}
    </>
  );
}

/** One season: when the ref can work, then their games and pay. */
async function SeasonBlock({
  season,
  userId,
  timeZone,
  now,
}: {
  season: { id: SeasonId; name: string };
  userId: UserId;
  timeZone: string;
  now: Date;
}) {
  const ids = { seasonId: season.id, userId };
  const [times, free, games, payouts, fee] = await Promise.all([
    seasonGameTimes(db, season.id),
    availabilityOf(db, season.id, userId),
    myRefereeGames(db, ids),
    payoutsOf(db, ids),
    payRate(db, season.id),
  ]);
  const ahead = times.filter((t) => t > now);
  const freeSet = new Set(free.map((d) => d.getTime()));
  const reffing = new Map(
    games.map((g) => [
      g.startsAt.getTime(),
      `${g.teamAName} vs ${g.teamBName}`,
    ]),
  );
  const days = Map.groupBy(ahead, (t) => localDate(t, timeZone));
  const dayLabel = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(d);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(d);
  const [pay] = paySheet(
    [
      {
        userId,
        name: "",
        gamesWorked: games.filter((g) => g.worked).length,
        paidCents: payouts.reduce((n, p) => n + p.amountCents, 0),
      },
    ],
    fee,
  );

  return (
    <section
      id={`season-${season.id}`}
      aria-labelledby={`season-${season.id}-name`}
      className="flex flex-col gap-6"
    >
      <h2 id={`season-${season.id}-name`} className="text-h2">
        {season.name}
      </h2>

      {ahead.length > 0 && (
        <form
          action={saveAvailabilityAction.bind(null, season.id)}
          className="flex flex-col gap-4 rounded-lg border border-border p-4"
        >
          <h3 className="text-h3">When can you ref?</h3>
          {[...days].map(([day, dayTimes]) => (
            <fieldset key={day} className="flex flex-col gap-1">
              <legend className="font-bold">
                {dayTimes[0] && dayLabel(dayTimes[0])}
              </legend>
              <div className="flex flex-wrap gap-x-4">
                {dayTimes.map((t) => {
                  const game = reffing.get(t.getTime());
                  return game ? (
                    <label
                      key={t.toISOString()}
                      className="inline-flex min-h-11 items-center gap-2"
                    >
                      <input
                        type="checkbox"
                        checked
                        disabled
                        aria-describedby={`reffing-${season.id}-${t.getTime()}`}
                        className="size-5"
                      />
                      {time(t)}
                      <span
                        id={`reffing-${season.id}-${t.getTime()}`}
                        className="text-small text-text-muted"
                      >
                        (you ref {game}; ask an admin if you can&rsquo;t make
                        it)
                      </span>
                    </label>
                  ) : (
                    <label
                      key={t.toISOString()}
                      className="inline-flex min-h-11 items-center gap-2"
                    >
                      <input
                        type="hidden"
                        name="shown"
                        value={t.toISOString()}
                      />
                      <input
                        type="checkbox"
                        name="free"
                        value={t.toISOString()}
                        defaultChecked={freeSet.has(t.getTime())}
                        className="size-5"
                      />
                      {time(t)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <SubmitButton className="btn self-start btn-primary">
            Save when I can ref
          </SubmitButton>
        </form>
      )}

      <section
        aria-labelledby={`season-${season.id}-pay`}
        className="flex flex-col gap-3"
      >
        <h3 id={`season-${season.id}-pay`} className="text-h3">
          Your games and pay
        </h3>
        {pay && (
          <p className="tabular-nums">
            {pay.gamesWorked} {pay.gamesWorked === 1 ? "game" : "games"} worked
            {fee !== null && ` at ${money(fee)} each`} · {money(pay.owedCents)}{" "}
            earned · {money(pay.paidCents)} paid ·{" "}
            <strong>
              {pay.balanceCents < 0
                ? `${money(-pay.balanceCents)} paid ahead`
                : `${money(pay.balanceCents)} still to come`}
            </strong>
          </p>
        )}
        {fee === null && (
          <p className="text-small text-text-muted">
            The league hasn&rsquo;t set this season&rsquo;s per-game fee yet.
          </p>
        )}
        {games.length === 0 ? (
          <p className="text-text-muted">No games assigned yet.</p>
        ) : (
          <ul className="flex flex-col">
            {games.map((g) => (
              <li
                key={g.gameId}
                id={`game-${g.gameId}`}
                className="flex flex-col gap-2 border-t border-border py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {g.teamAName} vs {g.teamBName}
                    <span className="block text-small text-text-muted">
                      {dayLabel(g.startsAt)}, {time(g.startsAt)} · {g.fieldName}
                    </span>
                  </span>
                  <span className="text-small">
                    {g.worked
                      ? "Worked"
                      : g.startsAt > now
                        ? "Coming up"
                        : "Not checked in"}
                  </span>
                </div>
                {!g.worked && g.startsAt > now && (
                  <details>
                    <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
                      Can&rsquo;t make it?
                      <span className="sr-only">
                        {" "}
                        {g.teamAName} vs {g.teamBName}
                      </span>
                    </summary>
                    <form
                      action={dropGameAction.bind(null, g.gameId)}
                      className="flex flex-col gap-2 pt-1"
                    >
                      <label className="flex flex-col gap-1 text-small">
                        Why? Admins see this.
                        <input
                          name="reason"
                          required
                          maxLength={DROP_REASON_MAX}
                          className="min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body"
                        />
                      </label>
                      <p className="text-small text-text-muted">
                        If the game is within a day, the league&rsquo;s other
                        refs who are free then are asked to take it.
                      </p>
                      <SubmitButton className="btn self-start btn-secondary">
                        Drop this game
                      </SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {payouts.length > 0 && (
          <ul className="text-small text-text-muted">
            {payouts.map((p) => (
              <li key={p.id}>
                Paid {money(p.amountCents)} by {PAYOUT_METHOD_LABELS[p.method]}{" "}
                on{" "}
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${p.paidOn}T12:00:00Z`))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
