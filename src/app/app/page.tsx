import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { ballotsWaiting } from "@/db/queries/awards";
import { fieldPermitForGame } from "@/db/queries/books";
import { myGiveawayWins } from "@/db/queries/giveaways";
import { publishedGamesFor } from "@/db/queries/public-schedule";
import { gamesToReferee } from "@/db/queries/referees";
import { openSeasons } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { pickupsFor } from "@/db/queries/subs";
import { AllOutboxStatus } from "@/components/offline-outbox";
import { Pickups } from "@/components/pickups";
import { can } from "@/domain/authz/permissions";
import { isGameDay } from "@/domain/lineup/access";
import {
  type GameId,
  parseId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import {
  offeredInstall,
  offlineGame,
  pickNextGame,
} from "@/domain/pwa/offline";
import { auth } from "@/lib/auth";
import { currentSubject } from "@/lib/auth/permission";
import { featureEnabled } from "@/lib/platform/site";
import { signOut } from "./actions";
import { InstallPrompt } from "./install-prompt";
import { OfflineSync, SignOutForm } from "./offline-sync";

export const metadata: Metadata = { title: "Home" };

export default function AppHome() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<p>Loading your account…</p>}>
        <Account />
      </Suspense>
    </main>
  );
}

async function Account() {
  // proxy.ts only checks that a cookie exists; this verifies the session itself.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/app");

  const { name, email } = session.user;
  const subject = await currentSubject();
  // Started now so it runs alongside the queries below: the next game is
  // kept on the device for when the field has no signal.
  const myGames = publishedGamesFor(db, {
    teamSeasonIds: subject.roster.flatMap(
      (m) => parseId<TeamSeasonId>(m.teamSeasonId) ?? [],
    ),
    gameIds: subject.refereeGameIds.flatMap((id) => parseId<GameId>(id) ?? []),
  });
  // Also started early: open awards this person has not voted in yet.
  const waiting = (async () => {
    const id = parseId<UserId>(subject.userId);
    if (!id || subject.roster.length === 0) return 0;
    if (!(await featureEnabled("awards"))) return 0;
    return ballotsWaiting(db, id, new Date());
  })();
  // Giveaways this person won at league events, started early too.
  const wins = (async () => {
    const id = parseId<UserId>(subject.userId);
    return id ? myGiveawayWins(db, id) : [];
  })();
  const isAdmin = can(subject, "season.manage", {});
  const league = await currentLeague(db);
  const now = new Date();
  const open = league ? await openSeasons(db, league.id, now) : [];
  // Games this person referees that are not final yet.
  const userId = parseId<UserId>(subject.userId);
  const refereeing =
    userId && subject.isReferee
      ? (await gamesToReferee(db, userId)).filter(
          (g) => g.status !== "final" && g.status !== "forfeit",
        )
      : [];
  const pickups = await pickupsFor(
    db,
    refereeing.map((g) => g.id),
  );
  const nextGame = pickNextGame(await myGames, now);
  // The next game's park permit, for its ref and captains (ADR 0034).
  const nextGameId = parseId<GameId>(nextGame?.id);
  const permitShown =
    nextGame !== null &&
    nextGameId !== null &&
    can(subject, "permit.view_at_field", {
      game: {
        id: nextGame.id,
        teamSeasonIds: [nextGame.teamA.id, nextGame.teamB.id],
      },
    }) &&
    (await fieldPermitForGame(db, nextGameId)) !== null;
  const ballots = await waiting;
  const won = await wins;
  const timeZone = league?.timeZone ?? "America/New_York";
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h1">You&apos;re in!</h1>
        <p className="text-text-muted">
          Signed in as <strong className="text-text">{name || email}</strong>.
          Your season stuff will live here.
        </p>
      </div>
      {offeredInstall(subject) && <AllOutboxStatus />}
      {won.length > 0 && (
        <section
          aria-labelledby="won"
          className="flex flex-col gap-2 rounded-card border-2 border-success p-4"
        >
          <h2 id="won" className="text-h3">
            <span aria-hidden="true">🎉 </span>You won
          </h2>
          <ul className="flex flex-col gap-1">
            {won.map((w) => (
              <li key={`${w.eventSlug}-${w.drawnAt.getTime()}`}>
                <Link
                  href={`/app/events/${w.eventSlug}/giveaway`}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {w.prize}, at {w.eventTitle}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {refereeing.length > 0 && (
        <section aria-labelledby="refereeing" className="flex flex-col gap-2">
          <h2 id="refereeing" className="text-h3">
            Games you&apos;re refereeing
          </h2>
          <ul className="flex flex-col">
            {refereeing.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-2 border-t border-border py-2"
              >
                <span>
                  {g.teamAName} vs {g.teamBName}
                  <span className="block text-small text-text-muted">
                    {when(g.startsAt)} · {g.fieldName}
                  </span>
                  <Pickups
                    pickups={pickups.get(g.id)}
                    teams={[
                      { id: g.teamAId, name: g.teamAName },
                      { id: g.teamBId, name: g.teamBName },
                    ]}
                  />
                </span>
                <span className="flex flex-col items-end gap-1">
                  {g.startsAt <= now && (
                    <Link
                      href={`/app/games/${g.id}/score`}
                      className="btn btn-primary"
                    >
                      Score
                    </Link>
                  )}
                  {isGameDay(g.startsAt, now, timeZone) && (
                    <Link
                      href={`/app/games/${g.id}/lineup`}
                      className="text-small underline"
                    >
                      Kicking orders
                      <span className="sr-only">
                        {" "}
                        for {g.teamAName} vs {g.teamBName}
                      </span>
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {open.map((s) => (
        <Link
          key={s.slug}
          href={`/app/seasons/${s.slug}`}
          className="btn btn-primary"
        >
          {s.name}: register or check your spot
        </Link>
      ))}
      {permitShown && nextGame && (
        <Link
          href={`/app/games/${nextGame.id}/permit`}
          className="btn btn-secondary"
        >
          Park permit for your next game
        </Link>
      )}
      {ballots > 0 && (
        <Link href="/app/vote" className="btn btn-primary">
          Vote for awards ({ballots} open)
        </Link>
      )}
      <Link href="/app/subs" className="btn btn-secondary">
        Sub for a team
      </Link>
      <Link href="/app/events" className="btn btn-secondary">
        Events
      </Link>
      <Link href="/app/profile" className="btn btn-secondary">
        Your profile
      </Link>
      {subject.sponsorIds.length > 0 && (
        <Link href="/app/sponsor" className="btn btn-secondary">
          Your sponsor page
        </Link>
      )}
      {isAdmin && (
        <Link href="/app/admin" className="btn btn-primary">
          League admin
        </Link>
      )}
      <SignOutForm action={signOut} />
      <OfflineSync
        game={
          nextGame
            ? offlineGame(
                nextGame,
                league?.timeZone ?? "America/New_York",
                permitShown,
              )
            : null
        }
      />
      {offeredInstall(subject) && (
        <>
          {/* Room to scroll past the floating offer, drawn with the page so nothing shifts. */}
          <div aria-hidden="true" className="h-48" />
          <InstallPrompt />
        </>
      )}
    </>
  );
}
