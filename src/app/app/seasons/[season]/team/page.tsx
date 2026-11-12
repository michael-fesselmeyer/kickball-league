import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { openTeamInvite, rosterBoard } from "@/db/queries/invites";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { createInviteAction } from "./actions";
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

async function Team({ params }: PageProps<"/app/seasons/[season]/team">) {
  const { season: slug } = await params;
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
  const link = manages
    ? await openTeamInvite(db, teamSeasonId, new Date())
    : null;
  const paid = board.filter((m) => m.paid).length;
  const signed = board.filter((m) => m.signed).length;

  return (
    <>
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
                      <td>{visible && <Mark yes={m.paid} label="Paid" />}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
