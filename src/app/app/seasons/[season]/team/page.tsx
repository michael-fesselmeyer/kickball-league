import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { challengeForSeason } from "@/db/queries/challenges";
import { teamAvailability } from "@/db/queries/away";
import { openTeamInvite, rosterBoard } from "@/db/queries/invites";
import { mySpots, savedFor } from "@/db/queries/lineups";
import { myRsvps, type TeamRsvps, teamRsvps } from "@/db/queries/rsvps";
import { teamGames } from "@/db/queries/scores";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { pickupsFor } from "@/db/queries/subs";
import { creditBalance } from "@/db/queries/credit";
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
import { offerFor, teamCaptaincy } from "@/db/queries/captaincy";
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
import { type GuaranteeView, TeamMoney } from "./team-money";

export const metadata: Metadata = { title: "Your team" };

export default function TeamPage(
  props: PageProps<"/app/seasons/[season]/team">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading your team…</p>}>
        <Team {...props} />
      </Suspense>
    </main>
  );
}

const LEVEL_STYLE = {
  full: "text-success",
  short: "text-text",
  check: "text-warning",
  forfeit: "text-danger",
} as const;

/** One game's answer buttons, the team's counts and the fielding check. */
function Rsvp({
  action,
  mine,
  team,
  suspended,
}: {
  action: (form: FormData) => Promise<void>;
  mine: "in" | "out" | "maybe" | null;
  team: TeamRsvps | undefined;
  /** A suspended player can't say they're in. */
  suspended: boolean;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <span className="text-small text-text-muted">You:</span>
        {(
          [
            ["in", "In"],
            ["maybe", "Maybe"],
            ["out", "Out"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="submit"
            name="status"
            value={value}
            aria-pressed={mine === value}
            disabled={suspended && value === "in"}
            className={`rounded-full border px-3 py-0.5 text-small disabled:opacity-50 ${
              mine === value
                ? "border-text bg-text text-surface"
                : "border-border"
            }`}
          >
            {label}
          </button>
        ))}
      </form>
      {team && team.in === 0 ? (
        <p className="text-small text-text-muted">
          Nobody has said they&apos;re in yet. {team.maybe} maybe · {team.out}{" "}
          out · {team.noAnswer} no answer.
        </p>
      ) : (
        team && (
          <p className="text-small">
            <span className="text-text-muted">
              {team.in} in · {team.maybe} maybe · {team.out} out ·{" "}
              {team.noAnswer} no answer.{" "}
            </span>
            <span className={LEVEL_STYLE[team.fielding.level]}>
              {team.fielding.message}
            </span>
          </p>
        )
      )}
    </div>
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
}: PageProps<"/app/seasons/[season]/team">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("registration.join", {
    next: `/app/seasons/${slug}/team`,
  });
  const league = await currentLeague(db);
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
  const board = await rosterBoard(db, teamSeasonId);
  const games = await teamGames(db, teamSeasonId);
  const now = new Date();
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
  const rsvps = await teamRsvps(db, teamSeasonId, upcoming);
  const findsSubs = can(subject, "sub_request.post", { teamSeasonId });
  const pickups = await pickupsFor(db, upcoming);
  const seesPickups = (g: (typeof games)[number]) =>
    can(subject, "sub_request.view_pickups", {
      game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
    });
  // Kicking orders, for games not played yet (game day included).
  const unplayed = games
    .filter((g) => !["final", "forfeit", "cancelled"].includes(g.status))
    .map((g) => g.id);
  const buildsLineups = can(subject, "lineup.edit", { teamSeasonId });
  const [mineRsvps, spots, lineups, availability] = await Promise.all([
    myRsvps(db, subject.userId, upcoming),
    mySpots(db, subject.userId, unplayed),
    buildsLineups ? savedFor(db, teamSeasonId, unplayed) : new Set<string>(),
    // Away weeks, for games still to come.
    teamAvailability(
      db,
      teamSeasonId,
      games.filter((g) => upcoming.includes(g.id)),
      league?.timeZone ?? "America/New_York",
    ),
  ]);
  // Suspensions are enforced even with the feature switched off; captains
  // see that a player is out, never why.
  const suspended = await suspendedAmong(
    db,
    board.map((m) => m.userId),
    now,
  );
  const mySuspension = suspended.get(subject.userId);
  const ownRatings =
    can(subject, "sportsmanship.view_own", { teamSeasonId }) &&
    (await featureEnabled("discipline"))
      ? ownAverage(await scoresReceived(db, teamSeasonId))
      : null;
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
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
  const link = manages
    ? await openTeamInvite(db, teamSeasonId, new Date())
    : null;
  // Cash or Venmo from a teammate on a split fee (payment.record_offline).
  const records =
    (season.feeModel === "per_player" || mine.team.paymentMode === "split") &&
    can(subject, "payment.record_offline", { teamSeasonId });
  const error =
    typeof query.error === "string" ? PAYMENT_ERRORS[query.error] : undefined;
  const paid = board.filter((m) => m.paid).length;
  // The season's sign-up challenge, if there is one: this team's progress.
  const challenge = can(subject, "challenge.view_team", { teamSeasonId })
    ? await challengeForSeason(db, season.id)
    : null;
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
  // A split team's fee and its guarantee, for the team's captains.
  const guarantees = can(subject, "guarantee.manage", { teamSeasonId });
  const [balance, guarantee, credit] = guarantees
    ? await Promise.all([
        teamBalances(db, [teamSeasonId]).then((m) => m.get(teamSeasonId)),
        teamGuarantee(db, teamSeasonId),
        creditBalance(db, subject.userId),
      ])
    : [undefined, null, 0];
  const timeZone = league?.timeZone ?? "America/New_York";
  // The private "not on my team" list, for the team's captains only.
  const keepsOff = can(subject, "keep_off.manage", { teamSeasonId });
  // Who leads the team (ADR 0042): the captain changes it; a co-captain
  // sees it and can step down; a teammate offered the captaincy answers.
  const leads = can(subject, "captaincy.manage", { teamSeasonId });
  const coCaptain = mine.team.role === "co_captain";
  const [keepOff, myOffer] = await Promise.all([
    keepsOff ? teamKeepOffList(db, teamSeasonId) : [],
    offerFor(db, teamSeasonId, subject.userId),
  ]);
  const captaincy =
    leads || coCaptain || myOffer
      ? await teamCaptaincy(db, teamSeasonId)
      : null;
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
      {mySuspension && (
        <p className="rounded-lg border border-warning p-3">
          <strong>{mySuspension.label}.</strong> While you&apos;re suspended you
          can&apos;t say you&apos;re in for a game or claim a sub spot. To
          appeal, reply to the league&apos;s email about it.
        </p>
      )}
      <header className="flex flex-col gap-1">
        <Link href={`/app/seasons/${slug}`} className="underline">
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
        {can(subject, "announcement.send", { scope: "team", teamSeasonId }) && (
          <Link
            href={`/app/seasons/${slug}/team/announcements`}
            className="self-start underline"
          >
            Message your team
          </Link>
        )}
        {findsSubs && (
          <Link
            href={`/app/seasons/${slug}/team/subs`}
            className="self-start underline"
          >
            Find subs
          </Link>
        )}
        {can(subject, "conflicts.submit", { teamSeasonId }) && (
          <Link
            href={`/app/seasons/${slug}/team/requests`}
            className="self-start underline"
          >
            Scheduling requests
          </Link>
        )}
        <Link href="/app/profile#away" className="self-start underline">
          Away some weeks? Mark them
        </Link>
      </header>

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
          paymentsOn={stripeClient() !== null}
          notice={
            typeof query.guarantee === "string" ? query.guarantee : undefined
          }
        />
      )}

      {challenge && signups && (
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

      {manages && (
        <section aria-labelledby="invite" className="flex flex-col gap-3">
          <h2 id="invite" className="text-h2">
            Invite players
          </h2>
          <p>
            Share one link in your team chat. Each player signs in, joins, signs
            the waiver and pays their own share.
          </p>
          <InviteLink
            action={createInviteAction.bind(null, slug)}
            hasOpenLink={link !== null}
          />
        </section>
      )}

      <section aria-labelledby="roster" className="flex flex-col gap-3">
        <h2 id="roster" className="text-h2">
          Roster ({board.length}
          {mine.team.targetRosterSize
            ? ` of ${mine.team.targetRosterSize}`
            : ""}
          )
        </h2>
        {seesStatus && (
          <p className="text-text-muted">
            {signed} signed the waiver, {paid} paid.
          </p>
        )}
        {can(subject, "roster.export", { teamSeasonId }) && (
          <p className="flex flex-wrap gap-4">
            <a
              href={`/app/seasons/${slug}/export/roster.csv?team=${teamSeasonId}`}
              download
              className="underline"
            >
              Download the roster (CSV)
            </a>
            {can(subject, "payments.export", { teamSeasonId }) && (
              <a
                href={`/app/seasons/${slug}/export/payments.csv?team=${teamSeasonId}`}
                download
                className="underline"
              >
                Download payments (CSV)
              </a>
            )}
          </p>
        )}
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
                              <option value="other">Other</option>
                            </select>
                            <input type="hidden" name="note" value="" />
                            <button type="submit" className="underline">
                              Paid me
                            </button>
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
      </section>

      {captaincy && (leads || coCaptain) && (
        <CaptaincyPanel
          idPrefix="captaincy"
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

      <section aria-labelledby="games" className="flex flex-col gap-3">
        <h2 id="games" className="text-h2">
          Games
        </h2>
        {games.length === 0 ? (
          <p className="text-text-muted">The schedule is not out yet.</p>
        ) : (
          <ul className="flex flex-col">
            {games.map((g) => {
              const started = g.startsAt !== null && g.startsAt <= now;
              const week = availability.get(g.id);
              const done = g.status === "final" || g.status === "forfeit";
              return (
                <li
                  key={g.id}
                  id={`game-${g.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
                >
                  <span>
                    {g.startsAt ? day(g.startsAt) : "Not placed yet"}
                    <span className="text-text-muted">
                      {" "}
                      · vs {g.opponent}
                      {g.fieldName && ` · ${g.fieldName}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <strong className="tabular-nums">{result(g)}</strong>
                    {manages && started && (
                      <Link
                        href={`/app/games/${g.id}/score`}
                        className="underline"
                      >
                        {done ? "See score" : "Enter score"}
                      </Link>
                    )}
                  </span>
                  {rsvps.has(g.id) && (
                    <Rsvp
                      action={rsvpAction.bind(null, slug, g.id)}
                      mine={mineRsvps.get(g.id) ?? null}
                      team={rsvps.get(g.id)}
                      suspended={mySuspension !== undefined}
                    />
                  )}
                  {unplayed.includes(g.id) &&
                    (buildsLineups || spots.has(g.id)) && (
                      <span className="flex flex-wrap gap-3 text-small">
                        {spots.has(g.id) && (
                          <Link
                            href={`/app/games/${g.id}/lineup`}
                            className="underline"
                          >
                            You kick {ordinal(spots.get(g.id)?.position ?? 0)}{" "}
                            of {spots.get(g.id)?.of}
                          </Link>
                        )}
                        {buildsLineups && (
                          <Link
                            href={`/app/games/${g.id}/lineup/${teamSeasonId}`}
                            className="underline"
                          >
                            {lineups.has(g.id)
                              ? "Edit kicking order"
                              : "Set kicking order"}
                          </Link>
                        )}
                      </span>
                    )}
                  {week && (
                    <WeekAvailabilityNote
                      week={week}
                      captain={seesStatus}
                      subsHref={
                        findsSubs && g.kind !== "playoff"
                          ? `/app/seasons/${slug}/team/subs?game=${g.id}#ask`
                          : null
                      }
                    />
                  )}
                  {rsvps.has(g.id) && findsSubs && g.kind !== "playoff" && (
                    <Link
                      href={`/app/seasons/${slug}/team/subs?game=${g.id}#ask`}
                      className="text-small underline"
                    >
                      Short? Find subs
                    </Link>
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
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
