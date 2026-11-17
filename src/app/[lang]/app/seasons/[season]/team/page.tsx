import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { db } from "@/db/client";
import { challengeForSeason } from "@/db/queries/challenges";
import { teamAvailability } from "@/db/queries/away";
import { openTeamInvite, rosterBoard } from "@/db/queries/invites";
import { mySpots, savedFor } from "@/db/queries/lineups";
import { myRsvps, teamRsvps } from "@/db/queries/rsvps";
import { teamGames } from "@/db/queries/scores";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { pickupsFor } from "@/db/queries/subs";
import { creditBalance } from "@/db/queries/credit";
import { feeSettingsOf } from "@/db/queries/processing-fees";
import { DEFAULT_FEE_SETTINGS } from "@/domain/money/processing-fee";
import { describeCard, teamGuarantee } from "@/db/queries/guarantee";
import { teamBalances } from "@/db/queries/team-balance";
import { formatMoment } from "@/domain/money/credit";
import { chargeTime } from "@/domain/money/guarantee";
import { stripeClient } from "@/services/stripe";
import { can } from "@/domain/authz/permissions";
import { progressLine, teamProgress } from "@/domain/drive/challenge";
import { ordinal } from "@/domain/lineup/order";
import { formatCents } from "@/domain/registration/pricing";
import { Pickups } from "@/components/pickups";
import { WeekAvailabilityNote } from "@/components/week-availability";
import { scoresReceived, suspendedAmong } from "@/db/queries/discipline";
import { ownAverage } from "@/domain/discipline/discipline";
import { requirePermission } from "@/lib/auth/permission";
import { featureEnabled } from "@/lib/platform/site";
import { RECORD_PAYMENT_MESSAGES } from "../record-payment";
import { teamKeepOffList } from "@/db/queries/keep-off";
import { recruitingSummary, recruitingTeam } from "@/db/queries/move";
import { offerFor, teamCaptaincy } from "@/db/queries/captaincy";
import { checkInStep } from "@/db/queries/leadership";
import {
  addKeepOffAction,
  answerCaptaincyAction,
  cancelCaptaincyAction,
  createInviteAction,
  offerCaptaincyAction,
  recordTeamPaymentAction,
  removeKeepOffAction,
  rsvpAction,
  setTeamRoleAction,
  stepDownAction,
} from "./actions";
import { CaptaincyNotice, CaptaincyOffer, CaptaincyPanel } from "./captaincy";
import { InviteLink } from "./invite-link";
import { KeepOffSection } from "./keep-off";
import { teamShirtInfo } from "@/db/queries/shirt-late";
import { ShirtSection } from "./shirts";
import { inviteOpenPlayersAction } from "./recruit-actions";
import { RecruitingSection } from "./recruiting";
import { type GuaranteeView, TeamMoney } from "./team-money";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { Rsvp } from "./rsvp";
import { activeLeague } from "@/lib/league/active";
import { leagueHref } from "@/domain/league/paths";

export const metadata: Metadata = { title: "Your team" };

export default function TeamPage(
  props: PageProps<"/[lang]/app/seasons/[season]/team">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading your team…</PageLoading>}>
        <Team {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const PAYMENT_ERRORS: Record<string, string> = {
  ...RECORD_PAYMENT_MESSAGES,
  suspended: "You're suspended, so you can't say you're in until it's served.",
};

const ROLE: Record<string, string> = {
  captain: "Captain",
  co_captain: "Co-captain",
  player: "Player",
};

function Mark({ yes, label }: { yes: boolean; label: string }) {
  return (
    <span className={yes ? "text-success" : "text-text-muted"}>
      <span aria-hidden="true">{yes ? "✓" : "–"}</span>
      <span className="sr-only">
        {label}: {yes ? "yes" : "not yet"}
      </span>
    </span>
  );
}

async function Team({
  params,
  searchParams,
}: PageProps<"/[lang]/app/seasons/[season]/team">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const [subject, league] = await Promise.all([
    requirePermission("registration.join", {
      next: `/app/seasons/${slug}/team`,
    }),
    activeLeague(),
  ]);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  if (!mine?.team) notFound();
  const teamSeasonId = mine.team.teamSeasonId;

  const seesStatus = can(subject, "roster.view_status", { teamSeasonId });
  const manages = can(subject, "roster.manage", {
    teamSeasonId,
    targetRole: "player",
  });
  const now = new Date();
  const timeZone = league?.timeZone ?? "America/New_York";
  // Who reads what, decided before any of it is read.
  const findsSubs = can(subject, "sub_request.post", { teamSeasonId });
  const buildsLineups = can(subject, "lineup.edit", { teamSeasonId });
  const rates = can(subject, "sportsmanship.view_own", { teamSeasonId });
  // Cash or Venmo from a teammate on a split fee (payment.record_offline).
  const records =
    (season.feeModel === "per_player" || mine.team.paymentMode === "split") &&
    can(subject, "payment.record_offline", { teamSeasonId });
  // A split team's fee and its guarantee, for the team's captains.
  const guarantees = can(subject, "guarantee.manage", { teamSeasonId });
  // The private "not on my team" list, for the team's captains only.
  const keepsOff = can(subject, "keep_off.manage", { teamSeasonId });
  // Who leads the team (ADR 0042): the captain changes it; a co-captain
  // sees it and can step down; a teammate offered the captaincy answers.
  const leads = can(subject, "captaincy.manage", { teamSeasonId });
  const coCaptain = mine.team.role === "co_captain";
  // Players quietly open to a new team (ADR 0089), for the team's captains
  // while this season is recruiting: a count, and names of those who said
  // yes. The queries never count anyone who has played for this team.
  const recruits = can(subject, "move.recruit", { teamSeasonId });

  // Everything that needs only the team, read at once.
  const [
    board,
    games,
    link,
    challenge,
    ownRatings,
    [balance, guarantee, credit, fees],
    keepOff,
    myOffer,
    shirtInfo,
    recruiting,
    leadership,
  ] = await Promise.all([
    rosterBoard(db, teamSeasonId),
    teamGames(db, teamSeasonId),
    manages ? openTeamInvite(db, teamSeasonId, now) : null,
    // The season's sign-up challenge, if there is one: this team's progress.
    can(subject, "challenge.view_team", { teamSeasonId })
      ? challengeForSeason(db, season.id)
      : null,
    (async () =>
      rates && (await featureEnabled("discipline"))
        ? ownAverage(await scoresReceived(db, teamSeasonId))
        : null)(),
    guarantees
      ? Promise.all([
          teamBalances(db, [teamSeasonId]).then((m) => m.get(teamSeasonId)),
          teamGuarantee(db, teamSeasonId),
          creditBalance(db, subject.userId, league?.id ?? null),
          league ? feeSettingsOf(db, league.id) : DEFAULT_FEE_SETTINGS,
        ])
      : ([undefined, null, 0, DEFAULT_FEE_SETTINGS] as const),
    keepsOff ? teamKeepOffList(db, teamSeasonId) : [],
    offerFor(db, teamSeasonId, subject.userId),
    teamShirtInfo(db, teamSeasonId),
    recruits ? recruitingTeam(db, teamSeasonId, now) : null,
    // The season-end leadership check-in (ADR 0091), once one is open.
    checkInStep(db, teamSeasonId),
  ]);
  // Answers are for games still to come.
  const upcoming = games
    .filter(
      (g) =>
        g.startsAt !== null &&
        g.startsAt > now &&
        g.status !== "final" &&
        g.status !== "forfeit",
    )
    .map((g) => g.id);
  const seesPickups = (g: (typeof games)[number]) =>
    can(subject, "sub_request.view_pickups", {
      game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
    });
  // Kicking orders, for games not played yet (game day included).
  const unplayed = games
    .filter((g) => !["final", "forfeit", "cancelled"].includes(g.status))
    .map((g) => g.id);
  // Then everything that needs the games, the roster or the offer, at once.
  const [
    rsvps,
    pickups,
    mineRsvps,
    spots,
    lineups,
    availability,
    suspended,
    captaincy,
    recruitingNow,
  ] = await Promise.all([
    teamRsvps(db, teamSeasonId, upcoming),
    pickupsFor(db, upcoming),
    myRsvps(db, subject.userId, upcoming),
    mySpots(db, subject.userId, unplayed),
    buildsLineups ? savedFor(db, teamSeasonId, unplayed) : new Set<string>(),
    // Away weeks, for games still to come.
    teamAvailability(
      db,
      teamSeasonId,
      games.filter((g) => upcoming.includes(g.id)),
      timeZone,
    ),
    // Suspensions are enforced even with the feature switched off; captains
    // see that a player is out, never why.
    suspendedAmong(
      db,
      board.map((m) => m.userId),
      now,
    ),
    leads || coCaptain || myOffer ? teamCaptaincy(db, teamSeasonId) : null,
    recruiting ? recruitingSummary(db, recruiting, now) : null,
  ]);
  const mySuspension = suspended.get(subject.userId);
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  const shortDay = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(d);
  /** "W 7–4", "L 2–5", "T 3–3", "W (forfeit)", or empty before a result. */
  const result = (g: (typeof games)[number]) => {
    if (g.status === "forfeit")
      return g.forfeitBy === teamSeasonId ? "L (forfeit)" : "W (forfeit)";
    if (g.status !== "final" || g.scoreA === null || g.scoreB === null)
      return "";
    const [us, them] = g.home ? [g.scoreA, g.scoreB] : [g.scoreB, g.scoreA];
    return `${us > them ? "W" : us < them ? "L" : "T"} ${us}–${them}`;
  };
  const error =
    typeof query.error === "string" ? PAYMENT_ERRORS[query.error] : undefined;
  const paid = board.filter((m) => m.paid).length;
  const signups = challenge
    ? teamProgress(
        board.map((m) => ({
          joinedAt: m.joinedAt ?? now,
          signedAt: m.signed ? (m.joinedAt ?? now) : null,
        })),
        mine.team.targetRosterSize ?? season.rosterMin,
      )
    : null;
  const signed = board.filter((m) => m.signed).length;
  const deadline = season.paymentDeadlineAt;
  const guaranteeView: GuaranteeView = guarantee
    ? {
        card: describeCard(guarantee.brand, guarantee.last4),
        chargeOn:
          deadline &&
          guarantee.warnedAt &&
          guarantee.warnedForDeadline?.getTime() === deadline.getTime()
            ? formatMoment(chargeTime(deadline, guarantee.warnedAt), timeZone)
            : null,
        charge:
          guarantee.chargeStatus === null
            ? "none"
            : guarantee.chargeStatus === "open"
              ? "pending"
              : guarantee.chargeStatus === "failed"
                ? "declined"
                : "paid",
      }
    : null;

  // Captains and co-captains get the page in three views, linked as tabs
  // (the menu's Captain group links them too); a player gets one page.
  const captainView = manages || leads || coCaptain || keepsOff;
  // Without ?view=, an action's answer opens the view it belongs to.
  const asked =
    query.view === "roster" ||
    query.view === "settings" ||
    query.view === "games"
      ? query.view
      : query.captaincy || query.keep_off || query.shirts
        ? "settings"
        : query.recruit ||
            query.guarantee ||
            query.notice === "payment_recorded" ||
            (typeof query.error === "string" &&
              query.error in RECORD_PAYMENT_MESSAGES)
          ? "roster"
          : "games";
  const view: "all" | "games" | "roster" | "settings" = captainView
    ? asked
    : "all";
  const shows = (v: "games" | "roster" | "settings") =>
    view === "all" || view === v;
  const base = `/app/seasons/${slug}/team`;
  // Games still to be played, soonest first; the first is the next game.
  // One that started over three hours ago and has no result yet waits for
  // its score under Results instead.
  const over = (g: (typeof games)[number]) =>
    ["final", "forfeit", "cancelled"].includes(g.status) ||
    (g.status !== "in_progress" &&
      g.startsAt !== null &&
      g.startsAt.getTime() < now.getTime() - 3 * 60 * 60 * 1000);
  const toPlay = games.filter((g) => !over(g));
  const [nextGame, ...later] = toPlay;
  // Results, newest first.
  const played = games.filter((g) => !toPlay.includes(g)).toReversed();
  const subsFor = (g: (typeof games)[number]) =>
    findsSubs && g.kind !== "playoff" ? `${base}/subs?game=${g.id}#ask` : null;

  /** A game still to come: when, RSVPs, kicking order, subs and pickups. */
  const upcomingGame = (g: (typeof games)[number]) => {
    const week = availability.get(g.id);
    const subsHref = subsFor(g);
    const live = g.status === "in_progress";
    // Once players have answered, the RSVP counts say whether the team is
    // short; the away weeks then only name who's away.
    const answered = (rsvps.get(g.id)?.in ?? 0) > 0;
    const awayShort = !answered && week?.short === true;
    return (
      <div className="flex w-full flex-col gap-2">
        <p>
          <span className="font-bold">
            {g.startsAt ? day(g.startsAt) : "Not placed yet"}
          </span>
          <span className="text-text-muted">
            {" "}
            · vs {g.opponent}
            {g.fieldName && ` · ${g.fieldName}`}
          </span>
        </p>
        {live && (
          <Link
            href={
              league ? leagueHref(league, `/games/${g.id}`) : `/games/${g.id}`
            }
            className="btn self-start btn-primary"
          >
            Live now <span aria-hidden="true">→</span>
          </Link>
        )}
        {rsvps.has(g.id) && (
          <Rsvp
            action={rsvpAction.bind(null, slug, g.id)}
            mine={mineRsvps.get(g.id) ?? null}
            team={rsvps.get(g.id)}
            suspended={mySuspension !== undefined}
            when={g.startsAt ? shortDay(g.startsAt) : "this game"}
          />
        )}
        {(buildsLineups ||
          spots.has(g.id) ||
          (manages && g.startsAt !== null && g.startsAt <= now) ||
          (subsHref && !awayShort)) && (
          <div className="flex flex-wrap gap-2">
            {spots.has(g.id) && (
              <Link
                href={`/app/games/${g.id}/lineup`}
                className="btn px-4 text-small btn-secondary"
              >
                You kick {ordinal(spots.get(g.id)?.position ?? 0)} of{" "}
                {spots.get(g.id)?.of}
              </Link>
            )}
            {buildsLineups && (
              <Link
                href={`/app/games/${g.id}/lineup/${teamSeasonId}`}
                className="btn px-4 text-small btn-secondary"
              >
                {lineups.has(g.id) ? "Edit kicking order" : "Set kicking order"}
              </Link>
            )}
            {manages && g.startsAt !== null && g.startsAt <= now && (
              <Link
                href={`/app/games/${g.id}/score`}
                className="btn px-4 text-small btn-secondary"
              >
                Enter score
              </Link>
            )}
            {/* One way to ask for subs: the short-week note has its own. */}
            {subsHref && !awayShort && (
              <Link
                href={subsHref}
                className="btn px-4 text-small btn-secondary"
              >
                Find subs
              </Link>
            )}
          </div>
        )}
        {week && (
          <WeekAvailabilityNote
            week={answered ? { ...week, short: false } : week}
            captain={seesStatus}
            subsHref={subsHref}
            showCount={!answered}
          />
        )}
        {seesPickups(g) && (
          <Pickups
            pickups={pickups.get(g.id)}
            teams={[
              { id: g.teamAId, name: g.teamAName },
              { id: g.teamBId, name: g.teamBName },
            ]}
          />
        )}
      </div>
    );
  };

  const nextSection = shows("games") && (
    <section aria-labelledby="next-game" className="flex flex-col gap-3">
      <h2 id="next-game" className="text-h2">
        Next game
      </h2>
      {nextGame ? (
        // A list of one, like Upcoming and Results, so every game is found
        // the same way.
        <ul>
          <li
            id={`game-${nextGame.id}`}
            className="rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
          >
            {upcomingGame(nextGame)}
          </li>
        </ul>
      ) : (
        <p className="text-text-muted">
          {games.length === 0
            ? "The schedule is not out yet."
            : "No more games this season."}
        </p>
      )}
    </section>
  );

  const upcomingSection = shows("games") && later.length > 0 && (
    <section aria-labelledby="upcoming" className="flex flex-col gap-2">
      <h2 id="upcoming" className="text-h2">
        Upcoming
      </h2>
      <ul className="flex flex-col">
        {later.map((g) => (
          <li
            key={g.id}
            id={`game-${g.id}`}
            className="border-t border-border py-3"
          >
            {upcomingGame(g)}
          </li>
        ))}
      </ul>
    </section>
  );

  const resultsSection = shows("games") && played.length > 0 && (
    <section aria-labelledby="results" className="flex flex-col gap-2">
      <h2 id="results" className="text-h2">
        Results
      </h2>
      <ul className="flex flex-col">
        {played.map((g) => (
          <li
            key={g.id}
            id={`game-${g.id}`}
            className="flex flex-wrap items-center justify-between gap-x-3 border-t border-border py-2"
          >
            <span>
              {g.startsAt ? day(g.startsAt) : "Not placed"}
              <span className="text-text-muted"> · vs {g.opponent}</span>
            </span>
            <span className="flex items-center gap-3">
              <strong className="tabular-nums">
                {g.status === "cancelled"
                  ? "Called off"
                  : result(g) || "No score yet"}
              </strong>
              {manages && g.status !== "cancelled" && (
                <Link
                  href={`/app/games/${g.id}/score`}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {g.status === "final" || g.status === "forfeit"
                    ? "See score"
                    : "Enter score"}
                  <span className="sr-only"> vs {g.opponent}</span>
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  /** A player's roster: names and roles, the rest folded past eight. */
  const ROSTER_SHOWN = 8;
  const rosterRow = (m: (typeof board)[number]) => (
    <li
      key={m.userId}
      className="flex min-h-11 items-center justify-between gap-2 border-t border-border py-1"
    >
      <span>
        {m.name}
        {m.userId === subject.userId && suspended.has(m.userId) && (
          <span className="ml-2 rounded-full border border-warning px-2 text-small">
            {suspended.get(m.userId)?.label}
          </span>
        )}
      </span>
      {m.role !== "player" && (
        <span className="text-small text-text-muted">{ROLE[m.role]}</span>
      )}
    </li>
  );

  const rosterSection = shows("roster") && (
    <section aria-labelledby="roster" className="flex flex-col gap-3">
      <h2 id="roster" className="text-h2">
        Roster ({board.length}
        {mine.team.targetRosterSize ? ` of ${mine.team.targetRosterSize}` : ""})
      </h2>
      {shirtInfo?.ownShirts && (
        <p className="text-text-muted">
          <span className="sticker text-micro">Own shirts</span> This team wears
          its own shirts or jerseys, not the league&apos;s.
        </p>
      )}
      {seesStatus && (
        <p className="text-text-muted">
          {signed} signed the waiver, {paid} paid.
        </p>
      )}
      {can(subject, "roster.export", { teamSeasonId }) && (
        <p className="flex flex-wrap gap-x-4">
          <a
            href={`/app/seasons/${slug}/export/roster.csv?team=${teamSeasonId}`}
            download
            className="inline-flex min-h-11 items-center underline"
          >
            Download the roster (CSV)
          </a>
          {can(subject, "payments.export", { teamSeasonId }) && (
            <a
              href={`/app/seasons/${slug}/export/payments.csv?team=${teamSeasonId}`}
              download
              className="inline-flex min-h-11 items-center underline"
            >
              Download payments (CSV)
            </a>
          )}
        </p>
      )}
      {seesStatus ? (
        <table className="w-full text-left">
          <thead className="text-text-muted">
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              {seesStatus && (
                <>
                  <th scope="col">Waiver</th>
                  <th scope="col">Paid</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {board.map((m) => {
              const visible = seesStatus || m.userId === subject.userId;
              return (
                <tr key={m.userId} className="border-t border-border">
                  <td className="py-2">
                    {m.name}
                    {(seesStatus || m.userId === subject.userId) &&
                      suspended.has(m.userId) && (
                        <span className="ml-2 rounded-full border border-warning px-2 text-small">
                          {suspended.get(m.userId)?.label}
                        </span>
                      )}
                  </td>
                  <td>{ROLE[m.role]}</td>
                  {seesStatus && (
                    <>
                      <td>
                        {visible && <Mark yes={m.signed} label="Waiver" />}
                      </td>
                      <td>
                        {visible && <Mark yes={m.paid} label="Paid" />}
                        {records && m.signed && !m.paid && (
                          <form
                            action={recordTeamPaymentAction.bind(
                              null,
                              slug,
                              m.registrationId,
                            )}
                            className="mt-1 flex flex-wrap items-center gap-2"
                          >
                            <select
                              name="method"
                              defaultValue="cash"
                              aria-label={`How ${m.name} paid`}
                              className="rounded-md border border-border bg-surface px-1"
                            >
                              <option value="cash">Cash</option>
                              <option value="venmo">Venmo</option>
                              <option value="zelle">Zelle</option>
                              <option value="check">Check</option>
                              <option value="other">Other</option>
                            </select>
                            <input type="hidden" name="note" value="" />
                            <SubmitButton className="min-h-11 underline">
                              Paid me
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <>
          <ul className="flex flex-col">
            {board.slice(0, ROSTER_SHOWN).map(rosterRow)}
          </ul>
          {board.length > ROSTER_SHOWN && (
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold underline">
                Show all {board.length}
              </summary>
              <ul className="flex flex-col">
                {board.slice(ROSTER_SHOWN).map(rosterRow)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );

  const TABS = [
    { id: "games", label: "Games", href: base },
    { id: "roster", label: "Roster and payments", href: `${base}?view=roster` },
    { id: "settings", label: "Team settings", href: `${base}?view=settings` },
  ] as const;

  return (
    <>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {query.notice === "payment_recorded" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Payment recorded. They&apos;re paid up.
        </p>
      )}
      <CaptaincyNotice
        code={typeof query.captaincy === "string" ? query.captaincy : undefined}
      />
      {myOffer && captaincy && (
        <CaptaincyOffer
          team={mine.team.teamName}
          from={captaincy.pending?.fromName ?? "Your captain"}
          accept={answerCaptaincyAction.bind(null, slug, myOffer, true)}
          decline={answerCaptaincyAction.bind(null, slug, myOffer, false)}
        />
      )}
      {leadership && leadership.step !== "closed" && (
        <Link
          href={`/app/seasons/${slug}/team/leadership`}
          className="flex flex-col gap-1 rounded-lg border border-border p-3"
        >
          <span className="font-semibold underline">
            {leadership.step === "check_in"
              ? "Leadership check-in: who'd you like to help lead next season?"
              : leadership.step === "ballot"
                ? "Leadership check-in: the secret ballot is open"
                : "Leadership check-in: voting has closed"}
          </span>
          <span className="text-small text-text-muted">
            {leadership.paused
              ? "Paused by the league for now."
              : "Private: nobody sees your answer."}
          </span>
        </Link>
      )}
      {mySuspension && (
        <p className="rounded-lg border border-warning p-3">
          <strong>{mySuspension.label}.</strong> While you&apos;re suspended you
          can&apos;t say you&apos;re in for a game or claim a sub spot. To
          appeal, reply to the league&apos;s email about it.
        </p>
      )}
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="flex items-center gap-3 text-h1">
          {mine.team.teamColor && (
            <span
              aria-hidden="true"
              className="inline-block size-6 rounded-full border border-border"
              style={{ background: mine.team.teamColor }}
            />
          )}
          {mine.team.teamName}
        </h1>
        {mine.team.paymentMode === "split" && mine.team.shareCents !== null && (
          <p className="text-text-muted">
            Everyone pays a fixed {formatCents(mine.team.shareCents)}.
          </p>
        )}
        <p className="flex flex-wrap gap-x-4">
          <Link
            href="/app/profile#away"
            className="inline-flex min-h-11 items-center underline"
          >
            Away some weeks? Mark them
          </Link>
          {manages ? (
            <HelpLink
              audience="captain"
              article="invite"
              topic="running your team"
            />
          ) : (
            <HelpLink audience="player" article="rsvp" topic="your team page" />
          )}
        </p>
      </header>

      {captainView && (
        <nav aria-label="Team sections" className="-mt-4">
          <ul className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.href}
                  aria-current={view === t.id ? "page" : undefined}
                  className={`btn px-4 text-small ${
                    view === t.id
                      ? "border-2 border-text bg-text text-surface"
                      : "btn-secondary"
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Attendance and scheduling requests are in the menu's Captain group. */}
      {view === "games" && (
        <ul className="-mt-2 flex flex-wrap gap-x-4">
          {can(subject, "announcement.send", {
            scope: "team",
            teamSeasonId,
          }) && (
            <li>
              <Link
                href={`${base}/announcements`}
                className="inline-flex min-h-11 items-center underline"
              >
                Message your team
              </Link>
            </li>
          )}
          {findsSubs && (
            <li>
              <Link
                href={`${base}/subs`}
                className="inline-flex min-h-11 items-center underline"
              >
                Find subs
              </Link>
            </li>
          )}
        </ul>
      )}

      {nextSection}
      {upcomingSection}
      {view === "all" && rosterSection}
      {resultsSection}

      {shows("roster") && (
        <>
          {balance && (
            <TeamMoney
              slug={slug}
              balance={balance}
              deadline={
                deadline
                  ? new Intl.DateTimeFormat("en-US", {
                      dateStyle: "long",
                      timeZone,
                    }).format(deadline)
                  : null
              }
              guarantee={guaranteeView}
              creditCents={credit}
              fees={fees}
              paymentsOn={stripeClient() !== null}
              notice={
                typeof query.guarantee === "string"
                  ? query.guarantee
                  : undefined
              }
            />
          )}
          {manages && (
            <section aria-labelledby="invite" className="flex flex-col gap-3">
              <h2 id="invite" className="text-h2">
                Invite players
              </h2>
              <p>
                Share one link in your team chat. Each player signs in, joins
                and signs the waiver
                {season.feeModel === "per_team" &&
                mine.team.paymentMode === "full"
                  ? "; you're paying the whole fee, so they don't pay anything."
                  : ", and pays their own share."}
              </p>
              <InviteLink
                action={createInviteAction.bind(null, slug)}
                hasOpenLink={link !== null}
              />
            </section>
          )}
          {view === "roster" && rosterSection}
          {recruiting && recruitingNow && (
            <RecruitingSection
              team={recruiting.teamName}
              summary={recruitingNow}
              notice={
                typeof query.recruit === "string" ? query.recruit : undefined
              }
              invite={inviteOpenPlayersAction.bind(null, slug)}
            />
          )}
        </>
      )}

      {(view === "all" || view === "roster") && challenge && signups && (
        <section
          aria-labelledby="challenge"
          className="flex flex-col gap-2 rounded-card border-2 border-brand p-4"
        >
          <h2 id="challenge" className="text-h3">
            Sign-up challenge: {progressLine(signups)}
          </h2>
          <div
            aria-hidden="true"
            className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className={`h-full rounded-full ${signups.percent === 100 ? "bg-success" : "bg-brand"}`}
              style={{ width: `${signups.percent}%` }}
            />
          </div>
          <p>
            {signups.percent === 100
              ? "Your whole roster is signed up!"
              : "Get every player to make an account and sign the waiver."}{" "}
            First team to 100% wins {challenge.prize}.
          </p>
          <Link
            href={`/app/seasons/${slug}/challenge`}
            className="inline-flex min-h-11 items-center self-start underline"
          >
            See the leaderboard
          </Link>
        </section>
      )}

      {shows("settings") && (
        <>
          {captaincy && (leads || coCaptain) && (
            <CaptaincyPanel
              idPrefix="captaincy"
              folded
              data={captaincy}
              viewerId={subject.userId}
              manage={leads}
              offer={offerCaptaincyAction.bind(null, slug)}
              cancel={cancelCaptaincyAction.bind(null, slug)}
              setRole={(userId, role) =>
                setTeamRoleAction.bind(null, slug, userId, role)
              }
              stepDown={coCaptain ? stepDownAction.bind(null, slug) : undefined}
            />
          )}
          {manages && shirtInfo && league && (
            <ShirtSection
              slug={slug}
              leagueId={league.id}
              info={shirtInfo}
              notice={
                typeof query.shirts === "string" ? query.shirts : undefined
              }
            />
          )}
          {keepsOff && (
            <KeepOffSection
              entries={keepOff}
              notice={
                typeof query.keep_off === "string" ? query.keep_off : undefined
              }
              add={addKeepOffAction.bind(null, slug)}
              remove={(id) => removeKeepOffAction.bind(null, slug, id)}
              when={(d) =>
                new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone,
                }).format(d)
              }
            />
          )}
          {ownRatings && (
            <section
              aria-labelledby="sportsmanship"
              className="flex flex-col gap-1"
            >
              <h2 id="sportsmanship" className="text-h2">
                Sportsmanship
              </h2>
              <p>
                {"average" in ownRatings
                  ? `Other captains rate your team ${ownRatings.average.toFixed(1)} of 5, from ${ownRatings.count} games.`
                  : `Your team's average shows once ${ownRatings.waitingFor} more ${ownRatings.waitingFor === 1 ? "game is" : "games are"} rated, so no single rating can be read from it.`}
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
