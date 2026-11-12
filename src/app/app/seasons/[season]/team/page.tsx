import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { openTeamInvite, rosterBoard } from "@/db/queries/invites";
import { myRsvps, type TeamRsvps, teamRsvps } from "@/db/queries/rsvps";
import { teamGames } from "@/db/queries/scores";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { RECORD_PAYMENT_MESSAGES } from "../record-payment";
import {
  createInviteAction,
  recordTeamPaymentAction,
  rsvpAction,
} from "./actions";
import { InviteLink } from "./invite-link";

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
}: {
  action: (form: FormData) => Promise<void>;
  mine: "in" | "out" | "maybe" | null;
  team: TeamRsvps | undefined;
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
            className={`rounded-full border px-3 py-0.5 text-small ${
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
const PAYMENT_ERRORS: Record<string, string> = RECORD_PAYMENT_MESSAGES;

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
  const mineRsvps = await myRsvps(db, subject.userId, upcoming);
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
  const signed = board.filter((m) => m.signed).length;

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
      </header>

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
                  <td className="py-2">{m.name}</td>
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
