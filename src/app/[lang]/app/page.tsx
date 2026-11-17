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
import { openSeasons } from "@/db/queries/registration";
import { myLeagues as leaguesOfMine, mySeasons } from "@/lib/nav/my-seasons";
import { pickupsFor } from "@/db/queries/subs";
import { myRsvps, teamRsvps } from "@/db/queries/rsvps";
import { suspendedAmong } from "@/db/queries/discipline";
import { rsvpAction } from "./seasons/[season]/team/actions";
import { Rsvp } from "./seasons/[season]/team/rsvp";
import { surveysWaitingFor } from "@/db/queries/surveys";
import { alertCardFor } from "@/db/queries/alert-choices";
import { AlertCardView } from "@/components/alert-card";
import { CARD_COPY } from "@/domain/notifications/alert-cards";
import { env } from "@/env";
import { AllOutboxStatus } from "@/components/offline-outbox";
import { Pickups } from "@/components/pickups";
import { can } from "@/domain/authz/permissions";
import { isGameDay } from "@/domain/lineup/access";
import { localDay } from "@/domain/schedule/public-game";
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
import { checkInAsRefereeAction } from "./referee-actions";
import { InstallPrompt } from "./install-prompt";
import { cardsVisible } from "@/domain/emergency/emergency";
import { Gear } from "./gear";
import { OfflineSync } from "./offline-sync";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeague } from "@/lib/league/active";
import { leagueBase, leagueHref } from "@/domain/league/paths";

export const metadata: Metadata = { title: "Home" };

export default function AppHome(props: PageProps<"/[lang]/app">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading your account…</PageLoading>}>
        <Account {...props} />
      </Suspense>
    </main>
  );
}

async function Account({ searchParams }: PageProps<"/[lang]/app">) {
  // proxy.ts only checks that a cookie exists; this verifies the session itself.
  const session = await currentAuthSession();
  if (!session) redirect("/sign-in?next=/app");

  const { name } = session.user;
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
    return id ? mySeasons(id, onShow) : [];
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
  // The one alert card to offer now, if any (issue #529), started early too.
  const alertCard = (async () => {
    const id = parseId<UserId>(subject.userId);
    return id
      ? alertCardFor(db, id, {
          now: new Date(),
          pushReady: Boolean(env.VAPID_PUBLIC_KEY),
        })
      : null;
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
  const leagues = userId ? leaguesOfMine(userId) : Promise.resolve([]);
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
  // Someone in more than one league sees which one is on show; switching
  // is in the menu's Account group.
  const inOtherLeagues = myLeagues.some((l) => l.id !== league?.id);
  const nextGame = pickNextGame(games, now);
  // This person's team in the next game, if they play in it (a ref may not):
  // its In / Maybe / Out go on the card while the game is still to come.
  const myTeamInNext = nextGame
    ? subject.roster.find(
        (m) =>
          m.teamSeasonId === nextGame.teamA.id ||
          m.teamSeasonId === nextGame.teamB.id,
      )
    : undefined;
  const nextIsLive = nextGame?.status === "in_progress";
  const answersNext =
    myTeamInNext !== undefined &&
    userId !== null &&
    !nextIsLive &&
    nextGame?.startsAt != null &&
    nextGame.startsAt > now;
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
  // The permit, the day's status and the RSVPs, read at once.
  const [permitShown, nextDay, nextRsvp] = await Promise.all([
    seesPermit && nextGameId !== null
      ? fieldPermitForGame(db, nextGameId).then((p) => p !== null)
      : false,
    nextGame && nextDate
      ? statusesFrom(db, nextGame.seasonId as SeasonId, nextDate).then(
          (days) => days.get(nextDate) ?? null,
        )
      : null,
    answersNext && nextGameId && userId && myTeamInNext
      ? Promise.all([
          myRsvps(db, userId, [nextGameId]),
          teamRsvps(db, myTeamInNext.teamSeasonId as TeamSeasonId, [
            nextGameId,
          ]),
          suspendedAmong(db, [userId], now),
        ]).then(([mine, team, suspended]) => ({
          mine: mine.get(nextGameId) ?? null,
          team: team.get(nextGameId),
          suspended: suspended.has(userId),
        }))
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
  const kits = await gear;
  const query = await searchParams;
  const won = await wins;
  const surveysOpen = await surveys;
  const [latestCard] = await cards;
  const offer = await alertCard;
  // Where the day's one "I'm at the field" button goes: the first of today's
  // games not checked in yet.
  const checkInGameId =
    refereeing.find(
      (g) => isGameDay(g.startsAt, now, timeZone) && !g.checkedInAt,
    )?.id ?? null;
  const nextStatus =
    nextGame && nextDay ? gameStatus(nextDay, nextGame.id) : null;
  const nextWords = nextStatus ? gameWords(nextStatus, timeZone) : null;
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  // What's waiting on this person, newest asks first: one short list
  // instead of a button for every page (the menu has those).
  const needs: { key: string; href: string; label: string }[] = [
    ...(ballots > 0
      ? [
          {
            key: "vote",
            href: "/app/vote",
            label: `Vote for awards (${ballots} open)`,
          },
        ]
      : []),
    ...(polls > 0
      ? [
          {
            key: "polls",
            href: "/app/polls",
            label: `Captains' poll waiting for your vote (${polls})`,
          },
        ]
      : []),
    ...surveysOpen.map((sv) => ({
      key: `survey-${sv.seasonSlug}`,
      href: `/app/seasons/${sv.seasonSlug}/survey`,
      label: `How was ${sv.seasonName}? Take the survey`,
    })),
    ...open.map((s) => ({
      key: `open-${s.slug}`,
      href: `/app/seasons/${s.slug}`,
      label: `${s.name}: register or check your spot`,
    })),
  ];
  const firstName = (name || "").trim().split(/\s+/)[0] || "there";
  const nothingYet =
    !nextGame &&
    mine.length === 0 &&
    needs.length === 0 &&
    refereeing.length === 0 &&
    won.length === 0;
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Hi, {firstName}</h1>
        {league && inOtherLeagues && (
          <p className="text-small text-text-muted">
            {league.name} · switch leagues in the menu
          </p>
        )}
      </header>
      {nextGame && (
        <section
          aria-labelledby="next-game"
          className="flex flex-col gap-1 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
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
          {nextIsLive && (
            <Link
              href={
                league
                  ? leagueHref(league, `/games/${nextGame.id}`)
                  : `/games/${nextGame.id}`
              }
              className="mt-1 btn self-start btn-primary"
            >
              Live now <span aria-hidden="true">→</span>
            </Link>
          )}
          {nextRsvp && nextGame.startsAt && (
            <div className="mt-1">
              <Rsvp
                action={rsvpAction.bind(null, nextGame.seasonSlug, nextGame.id)}
                mine={nextRsvp.mine}
                team={nextRsvp.team}
                suspended={nextRsvp.suspended}
                when={day(nextGame.startsAt)}
                counts={false}
              />
            </div>
          )}
          {nextDay && nextStatus && nextWords && (
            <GameDayNotice
              line={`${nextWords}.${nextDay.reason ? ` ${nextDay.reason}.` : ""}`}
              setAt={nextDay.setAt}
              timeZone={timeZone}
              tone={toneOf(nextStatus.kind)}
            />
          )}
          {(emergencyUntil || permitShown) && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {emergencyUntil && (
                <li>
                  <Link
                    href={`/app/games/${nextGame.id}/emergency`}
                    className="btn px-4 text-small btn-secondary"
                  >
                    Emergency contacts for today&apos;s game
                  </Link>
                </li>
              )}
              {emergencyUntil && (
                <li>
                  <Link
                    href={`/app/games/${nextGame.id}/checklist`}
                    className="btn px-4 text-small btn-secondary"
                  >
                    Today&apos;s game-day checklist
                  </Link>
                </li>
              )}
              {permitShown && (
                <li>
                  <Link
                    href={`/app/games/${nextGame.id}/permit`}
                    className="btn px-4 text-small btn-secondary"
                  >
                    Park permit for your next game
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>
      )}
      {needs.length > 0 && (
        <section aria-labelledby="needs-you" className="flex flex-col gap-2">
          <h2 id="needs-you" className="text-h3">
            Needs you
          </h2>
          <ul className="flex flex-col rounded-card border-2 border-text bg-surface px-4">
            {needs.map((n) => (
              <li
                key={n.key}
                className="border-b border-border last:border-b-0"
              >
                <Link href={n.href} className={ROW}>
                  {n.label}
                  <Chevron />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {offer && (
        <AlertCardView
          copy={CARD_COPY[offer]}
          publicKey={env.VAPID_PUBLIC_KEY ?? null}
        />
      )}
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
      {(mine.length > 0 || latestCard) && (
        <section aria-labelledby="your-season" className="flex flex-col gap-2">
          <h2 id="your-season" className="text-h3">
            Your season
          </h2>
          <ul className="flex flex-col rounded-card border-2 border-text bg-surface px-4">
            {mine.map((m) => (
              <li
                key={`${m.seasonSlug}-${m.teamName ?? "free"}`}
                className="border-b border-border last:border-b-0"
              >
                {m.teamName ? (
                  <Link
                    href={`/app/seasons/${m.seasonSlug}/team`}
                    className={ROW}
                  >
                    {m.teamName} · {m.seasonName}
                    <Chevron />
                  </Link>
                ) : (
                  <Link href={`/app/seasons/${m.seasonSlug}`} className={ROW}>
                    {m.seasonName}: free agent, check your spot
                    <Chevron />
                  </Link>
                )}
              </li>
            ))}
            {latestCard && (
              <li className="border-b border-border last:border-b-0">
                <Link
                  href={`/app/seasons/${latestCard.seasonSlug}/card`}
                  className={ROW}
                >
                  Your {latestCard.seasonName} season in kickball
                  <Chevron />
                </Link>
              </li>
            )}
          </ul>
          {mine.some((m) => m.teamName) && (
            <p className="text-small text-text-muted">
              Your team page has your games, RSVPs and who has paid.
            </p>
          )}
        </section>
      )}
      {offeredInstall(subject) && <AllOutboxStatus />}
      <Gear
        kits={kits}
        timeZone={timeZone}
        now={now}
        notice={
          typeof query.gear_notice === "string" ? query.gear_notice : null
        }
        error={typeof query.gear_error === "string" ? query.gear_error : null}
      />
      {subject.isReferee && (
        <section aria-labelledby="refereeing" className="flex flex-col gap-2">
          <h2 id="refereeing" className="text-h3">
            Games you&apos;re refereeing
          </h2>
          {checkInGameId ? (
            // One tap checks the ref in for all of the day's games.
            <form
              action={checkInAsRefereeAction}
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <input type="hidden" name="gameId" value={checkInGameId} />
              <SubmitButton className="btn btn-secondary">
                I&apos;m at the field
              </SubmitButton>
              <span className="text-small text-text-muted">
                For all of today&apos;s games
              </span>
            </form>
          ) : (
            refereeing.some(
              (g) => isGameDay(g.startsAt, now, timeZone) && g.checkedInAt,
            ) && (
              <p className="text-small text-success">
                You&apos;re checked in for today&apos;s games.
              </p>
            )
          )}
          {refereeing.length === 0 ? (
            <p className="text-text-muted">No games coming up.</p>
          ) : (
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
                  {(g.startsAt <= now ||
                    isGameDay(g.startsAt, now, timeZone)) && (
                    // One button per game: scoring, the live score and the
                    // kicking orders are all on the game's screen.
                    <Link
                      href={`/app/games/${g.id}/score`}
                      className="btn shrink-0 btn-primary"
                    >
                      Open game
                      <span className="sr-only">
                        {" "}
                        {g.teamAName} vs {g.teamBName}
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/app/referee"
            className="inline-flex min-h-11 items-center self-start underline"
          >
            Reffing: when you can work, and your pay
          </Link>
        </section>
      )}
      {isAdmin && (
        <section
          aria-labelledby="running-the-league"
          className="flex flex-col gap-2"
        >
          <h2 id="running-the-league" className="text-h3">
            Running the league
          </h2>
          <ul className="flex flex-col rounded-card border-2 border-text bg-surface px-4">
            <li className="border-b border-border">
              <Link href="/app/admin" className={ROW}>
                League admin
                <Chevron />
              </Link>
            </li>
            <li>
              <Link href="/app/admin/today" className={ROW}>
                Game day screen
                <Chevron />
              </Link>
            </li>
          </ul>
        </section>
      )}
      {nothingYet && !isAdmin && !subject.isReferee && (
        <p className="rounded-card border-2 border-dashed border-border-strong p-4 text-text-muted">
          Nothing needs you right now. When registration opens or your team has
          a game, it shows up here.{" "}
          <Link href="/app/subs" className="font-bold text-text underline">
            Sub for a team
          </Link>{" "}
          in the meantime.
        </p>
      )}
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

/** A row in a list card: the whole row is the link, 48px tall. */
const ROW =
  "flex min-h-12 items-center justify-between gap-3 py-2 font-bold hover:underline";

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 text-text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
