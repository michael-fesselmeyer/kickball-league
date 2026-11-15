import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { ballotsWaiting } from "@/db/queries/awards";
import { pollsWaiting } from "@/db/queries/captain-polls";
import { myCards } from "@/db/queries/season-cards";
import { myGear } from "@/db/queries/equipment";
import { fieldPermitForGame } from "@/db/queries/books";
import { myGiveawayWins } from "@/db/queries/giveaways";
import { publishedGamesFor } from "@/db/queries/public-schedule";
import { gamesToReferee } from "@/db/queries/referees";
import { myCurrentSeasons, openSeasons } from "@/db/queries/registration";
import { pickupsFor } from "@/db/queries/subs";
import { surveysWaitingFor } from "@/db/queries/surveys";
import { AllOutboxStatus } from "@/components/offline-outbox";
import { Pickups } from "@/components/pickups";
import { can } from "@/domain/authz/permissions";
import { isGameDay } from "@/domain/lineup/access";
import { localDay, newestTeamSeason } from "@/domain/schedule/public-game";
import {
  type GameId,
  type LeagueId,
  parseId,
  type SeasonId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import { statusesFrom } from "@/db/queries/game-day-status";
import { gameStatus, gameWords } from "@/domain/gameday/status";
import { GameDayNotice, toneOf } from "@/components/game-day-notice";
import {
  offeredInstall,
  offlineGame,
  pickNextGame,
} from "@/domain/pwa/offline";
import { currentAuthSession, currentSubject } from "@/lib/auth/permission";
import { featureEnabled } from "@/lib/platform/site";
import { signOut } from "./actions";
import { checkInAsRefereeAction } from "./referee-actions";
import { InstallPrompt } from "./install-prompt";
import { cardsVisible } from "@/domain/emergency/emergency";
import { Gear } from "./gear";
import { OfflineSync, SignOutForm } from "./offline-sync";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeague } from "@/lib/league/active";
import { LeagueSwitcher } from "@/components/league-switcher";
import { leaguesOf } from "@/db/queries/leagues";
import { leagueBase, leagueHref } from "@/domain/league/paths";

export const metadata: Metadata = { title: "Home" };

export default function AppHome(props: PageProps<"/app">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<PageLoading>Loading your account…</PageLoading>}>
        <Account {...props} />
      </Suspense>
    </main>
  );
}

async function Account({ searchParams }: PageProps<"/app">) {
  // proxy.ts only checks that a cookie exists; this verifies the session itself.
  const session = await currentAuthSession();
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
  // Captains' polls this person still owes a vote in, started early too.
  const pollsOwed = (async () => {
    const id = parseId<UserId>(subject.userId);
    if (!id || !subject.roster.some((m) => m.role !== "player")) return 0;
    return pollsWaiting(db, id, new Date());
  })();
  // Whether pick'em is on, started early too.
  const pickemOn = featureEnabled("pickem");
  // The league on show (ADR 0048): its seasons and cards only.
  const onShow = parseId<LeagueId>(subject.leagueId);
  // League gear this person has or brings to a game (issue #286), early too.
  const gear = (async () => {
    const id = parseId<UserId>(subject.userId);
    return id ? myGear(db, id, new Date()) : [];
  })();
  // Giveaways this person won at league events, started early too.
  const wins = (async () => {
    const id = parseId<UserId>(subject.userId);
    return id ? myGiveawayWins(db, id) : [];
  })();
  // The seasons this person plays in, with their team, started early too.
  const seasons = (async () => {
    const id = parseId<UserId>(subject.userId);
    return id ? myCurrentSeasons(db, id, onShow) : [];
  })();
  // Season surveys waiting for this player's answer, started early too.
  const surveys = (async () => {
    const id = parseId<UserId>(subject.userId);
    return id ? surveysWaitingFor(db, id) : [];
  })();
  // End-of-season cards, newest season first, started early too.
  const cards = (async () => {
    const id = parseId<UserId>(subject.userId);
    return id ? myCards(db, id, onShow) : [];
  })();
  const isAdmin = can(subject, "season.manage", {});
  const userId = parseId<UserId>(subject.userId);
  const now = new Date();
  // The league on show and its open seasons, this person's leagues, and the
  // games they referee that are not final yet (with their pickups), read
  // alongside each other and the queries above.
  const leagueAndSeasons = (async () => {
    const league = await activeLeague();
    return {
      league,
      open: league ? await openSeasons(db, league.id, now) : [],
    };
  })();
  const leagues = userId ? leaguesOf(db, userId) : Promise.resolve([]);
  const refereeingAndPickups = (async () => {
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
    return { refereeing, pickups };
  })();
  const [{ league, open }, myLeagues, { refereeing, pickups }, games] =
    await Promise.all([
      leagueAndSeasons,
      leagues,
      refereeingAndPickups,
      myGames,
    ]);
  // The league on show counts as theirs too, so its name is in the switcher.
  const switchable =
    league && !myLeagues.some((l) => l.id === league.id)
      ? [league, ...myLeagues]
      : myLeagues;
  const nextGame = pickNextGame(games, now);
  const teamSeason = newestTeamSeason(
    games,
    subject.roster.map((m) => m.teamSeasonId),
  );
  // The next game's park permit, for its ref and captains (ADR 0034).
  const nextGameId = parseId<GameId>(nextGame?.id);
  const seesPermit =
    nextGame !== null &&
    can(subject, "permit.view_at_field", {
      game: {
        id: nextGame.id,
        teamSeasonIds: [nextGame.teamA.id, nextGame.teamB.id],
      },
    });
  const timeZone = league?.timeZone ?? "America/New_York";
  // The next game's day status (issue #383): watching, late or off.
  const nextDate = nextGame?.startsAt
    ? localDay(nextGame.startsAt, timeZone)
    : null;
  // The permit and the day's status, read at once.
  const [permitShown, nextDay] = await Promise.all([
    seesPermit && nextGameId !== null
      ? fieldPermitForGame(db, nextGameId).then((p) => p !== null)
      : false,
    nextGame && nextDate
      ? statusesFrom(db, nextGame.seasonId as SeasonId, nextDate).then(
          (days) => days.get(nextDate) ?? null,
        )
      : null,
  ]);
  // On its day, the next game's emergency contacts, for its ref and
  // captains (ADR 0043); kept on the phone until midnight after.
  const emergency =
    nextGame !== null
      ? cardsVisible(
          {
            status: nextGame.status,
            startsAt: nextGame.startsAt,
            timeZone: league?.timeZone ?? "America/New_York",
          },
          {
            captainsGame: can(subject, "emergency_contact.view", {
              game: {
                id: nextGame.id,
                teamSeasonIds: [nextGame.teamA.id, nextGame.teamB.id],
              },
            }),
            refereesGame: false,
          },
          now,
        )
      : null;
  const emergencyUntil = emergency?.ok ? emergency.until : null;
  const ballots = await waiting;
  const polls = await pollsOwed;
  const mine = await seasons;
  const showPickem = await pickemOn;
  const kits = await gear;
  const query = await searchParams;
  const won = await wins;
  const surveysOpen = await surveys;
  const [latestCard] = await cards;
  // Where the day's one "I'm at the field" button goes: the first of today's
  // games not checked in yet.
  const checkInGameId =
    refereeing.find(
      (g) => isGameDay(g.startsAt, now, timeZone) && !g.checkedInAt,
    )?.id ?? null;
  const nextStatus =
    nextGame && nextDay ? gameStatus(nextDay, nextGame.id) : null;
  const nextWords = nextStatus ? gameWords(nextStatus, timeZone) : null;
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
        </p>
        <Link
          href="/help"
          prefetch={false}
          className="inline-flex min-h-11 items-center self-start text-small underline underline-offset-4"
        >
          Help center
        </Link>
      </div>
      {league && <LeagueSwitcher active={league} leagues={switchable} />}
      {nextGame && (
        <section
          aria-labelledby="next-game"
          className="flex flex-col gap-1 rounded-card border-2 border-text bg-surface p-4"
        >
          <h2 id="next-game" className="text-h3">
            Your next game
          </h2>
          <Link
            href={
              league
                ? leagueHref(league, `/games/${nextGame.id}`)
                : `/games/${nextGame.id}`
            }
            className="inline-flex min-h-11 items-center font-bold underline"
          >
            {nextGame.teamA.name} vs {nextGame.teamB.name}
          </Link>
          {nextGame.startsAt && (
            <p className="text-small text-text-muted">
              {when(nextGame.startsAt)}
              {nextGame.field ? ` · ${nextGame.field}` : ""}
              {nextGame.venue ? `, ${nextGame.venue.name}` : ""}
            </p>
          )}
          {nextDay && nextStatus && nextWords && (
            <GameDayNotice
              line={`${nextWords}.${nextDay.reason ? ` ${nextDay.reason}.` : ""}`}
              setAt={nextDay.setAt}
              timeZone={timeZone}
              tone={toneOf(nextStatus.kind)}
            />
          )}
        </section>
      )}
      {mine.length > 0 && (
        <section aria-labelledby="your-season" className="flex flex-col gap-2">
          <h2 id="your-season" className="text-h3">
            Your season
          </h2>
          <p className="text-small text-text-muted">
            Your team page has your games, RSVPs and who has paid.
          </p>
          <ul className="flex flex-col gap-2">
            {mine.map((m) => (
              <li key={`${m.seasonSlug}-${m.teamName ?? "free"}`}>
                {m.teamName ? (
                  <Link
                    href={`/app/seasons/${m.seasonSlug}/team`}
                    className="btn w-full btn-primary"
                  >
                    {m.teamName} · {m.seasonName}
                  </Link>
                ) : (
                  <Link
                    href={`/app/seasons/${m.seasonSlug}`}
                    className="btn w-full btn-secondary"
                  >
                    {m.seasonName}: free agent, check your spot
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
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
      <Gear
        kits={kits}
        timeZone={timeZone}
        now={now}
        notice={
          typeof query.gear_notice === "string" ? query.gear_notice : null
        }
        error={typeof query.gear_error === "string" ? query.gear_error : null}
      />
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
                    <>
                      <Link
                        href={`/app/games/${g.id}/score`}
                        className="btn btn-primary"
                      >
                        Score
                      </Link>
                      {/* Optional: skipping it changes nothing. */}
                      <Link
                        href={`/app/games/${g.id}/live`}
                        className="btn btn-secondary"
                      >
                        Keep score live
                        <span className="sr-only">
                          {" "}
                          for {g.teamAName} vs {g.teamBName}
                        </span>
                      </Link>
                    </>
                  )}
                  {isGameDay(g.startsAt, now, timeZone) &&
                    (g.checkedInAt ? (
                      <span className="text-small text-success">
                        Checked in
                      </span>
                    ) : g.id === checkInGameId ? (
                      // One tap checks the ref in for all of the day's
                      // games, so the button shows once, on the first.
                      <form action={checkInAsRefereeAction}>
                        <input type="hidden" name="gameId" value={g.id} />
                        <SubmitButton className="btn btn-secondary">
                          I&apos;m at the field
                        </SubmitButton>
                        <span className="block text-small text-text-muted">
                          For all of today&apos;s games
                        </span>
                      </form>
                    ) : null)}
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
      {subject.isReferee && (
        <Link
          href="/app/referee"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Reffing: when you can work, and your pay
        </Link>
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
      {emergencyUntil && nextGame && (
        <Link
          href={`/app/games/${nextGame.id}/emergency`}
          className="btn btn-secondary"
        >
          Emergency contacts for today&apos;s game
        </Link>
      )}
      {emergencyUntil && nextGame && (
        <Link
          href={`/app/games/${nextGame.id}/checklist`}
          className="btn btn-secondary"
        >
          Today&apos;s game-day checklist
        </Link>
      )}
      {permitShown && nextGame && (
        <Link
          href={`/app/games/${nextGame.id}/permit`}
          className="btn btn-secondary"
        >
          Park permit for your next game
        </Link>
      )}
      {teamSeason && (
        <>
          <Link
            href={`/app/seasons/${teamSeason}/team`}
            className="btn btn-secondary"
          >
            Your team
          </Link>
          <Link
            href={`/seasons/${teamSeason}/schedule`}
            className="btn btn-secondary"
          >
            Schedule
          </Link>
        </>
      )}
      {latestCard && (
        <Link
          href={`/app/seasons/${latestCard.seasonSlug}/card`}
          className="btn btn-primary"
        >
          Your {latestCard.seasonName} season in kickball
        </Link>
      )}
      {ballots > 0 && (
        <Link href="/app/vote" className="btn btn-primary">
          Vote for awards ({ballots} open)
        </Link>
      )}
      {polls > 0 && (
        <Link href="/app/polls" className="btn btn-primary">
          Captains&apos; poll waiting for your vote ({polls})
        </Link>
      )}
      {surveysOpen.map((sv) => (
        <Link
          key={sv.seasonSlug}
          href={`/app/seasons/${sv.seasonSlug}/survey`}
          className="btn btn-primary"
        >
          How was {sv.seasonName}? Take the survey
        </Link>
      ))}
      {showPickem && (
        <Link href="/app/pickem" className="btn btn-secondary">
          Pick&apos;em
        </Link>
      )}
      <Link href="/app/subs" className="btn btn-secondary">
        Sub for a team
      </Link>
      <Link href="/app/events" className="btn btn-secondary">
        Events
      </Link>
      <Link href="/app/volunteer" className="btn btn-secondary">
        Volunteer
      </Link>
      <Link href="/app/shop" className="btn btn-secondary">
        League shop
      </Link>
      {can(subject, "photos.upload") && (
        <Link href="/app/photos" className="btn btn-secondary">
          Share a photo
        </Link>
      )}
      <Link href="/app/concerns" className="btn btn-secondary">
        Raise a concern
      </Link>
      <Link href="/app/lost-and-found" className="btn btn-secondary">
        Lost and found
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
                emergencyUntil,
                league ? leagueBase(league) : "",
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
