import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  type MyNewTeamRequest,
  myNewTeamRequest,
  requesterStanding,
} from "@/db/queries/new-teams";
import { profileOf } from "@/db/queries/profile";
import { seasonForRegistration } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { readyToRegister } from "@/domain/profile/profile-form";
import { priceFor, registrationWindow } from "@/domain/registration/pricing";
import { localDate } from "@/domain/scheduler/slots";
import { requirePermission } from "@/lib/auth/permission";
import { requestNewTeamAction, withdrawNewTeamAction } from "./actions";
import { NewTeamForm } from "./new-team-form";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Start a new team" };

export default function NewTeamPage(
  props: PageProps<"/app/seasons/[season]/new-team">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<NewTeamSkeleton />}>
        <NewTeam {...props} />
      </Suspense>
    </main>
  );
}

/** Holds the heading and form's space so nothing jumps when they arrive. */
function NewTeamSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="h-5 w-32 rounded bg-surface-2" />
        <div className="h-9 w-56 rounded bg-surface-2" />
      </div>
      <div className="h-40 rounded-lg bg-surface-2" />
      <div className="h-96 rounded-lg bg-surface-2" />
    </div>
  );
}

const ROLE: Record<string, string> = {
  captain: "captain",
  co_captain: "co-captain",
  player: "a player",
};

function RequestCard({
  slug,
  request,
  timeZone,
}: {
  slug: string;
  request: MyNewTeamRequest;
  timeZone: string;
}) {
  const asked = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone,
  }).format(request.createdAt);
  if (request.status === "pending")
    return (
      <section
        aria-labelledby="your-request"
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <h2 id="your-request" className="text-h3">
          Waiting for the league
        </h2>
        <p>
          You asked to start <strong>{request.proposedName}</strong> for about{" "}
          {request.expectedSize} players on {asked}. You&apos;ll get an email
          when an admin answers.
        </p>
        {request.note && (
          <p className="text-text-muted">Your note: {request.note}</p>
        )}
        <form action={withdrawNewTeamAction.bind(null, slug, request.id)}>
          <SubmitButton className="btn btn-secondary">
            Withdraw the request
          </SubmitButton>
        </form>
      </section>
    );
  if (request.status === "approved")
    return (
      <section
        aria-labelledby="your-request"
        className="flex flex-col gap-3 rounded-lg border border-success p-4"
      >
        <h2 id="your-request" className="text-h3">
          {request.proposedName} is approved
        </h2>
        <p>
          You&apos;re the captain. Share your team&apos;s invite link so your
          players can join.
        </p>
        <Link
          href={`/app/seasons/${slug}/team`}
          className="btn self-start btn-primary"
        >
          Invite your players
        </Link>
      </section>
    );
  if (request.status === "declined")
    return (
      <section
        aria-labelledby="your-request"
        className="flex flex-col gap-2 rounded-lg border border-warning p-4"
      >
        <h2 id="your-request" className="text-h3">
          The league declined {request.proposedName}
        </h2>
        {request.declineReason && (
          <p>From the league: {request.declineReason}</p>
        )}
        <p className="text-text-muted">You can ask again below.</p>
      </section>
    );
  return null;
}

async function NewTeam({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]/new-team">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("team.request_new", {
    next: `/app/seasons/${slug}/new-team`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const now = new Date();
  const [request, standing, person] = await Promise.all([
    myNewTeamRequest(db, season.id, subject.userId),
    requesterStanding(db, season.id, subject.userId),
    profileOf(db, subject.userId),
  ]);
  const complete =
    person !== null && readyToRegister(person, localDate(now, league.timeZone));
  const open = registrationWindow(season, now) === "open";
  const captains = standing?.team?.role === "captain";
  // Waiting for an answer, or already approved: the card above says what next.
  const settled =
    request?.status === "pending" || request?.status === "approved";
  const fee = priceFor(
    season,
    { kind: "captain", paymentMode: "full", rosterSize: season.rosterMin },
    now,
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Start a new team</h1>
      </header>
      {query.sent && (
        <p role="status" className="rounded-lg border border-success p-3">
          Request sent. The league will email you its answer.
        </p>
      )}
      {query.withdrawn && (
        <p role="status" className="rounded-lg border border-success p-3">
          Request withdrawn.
        </p>
      )}
      {query.error && (
        <p role="alert" className="rounded-lg border border-warning p-3">
          That request has already been answered.
        </p>
      )}
      {request && (
        <RequestCard slug={slug} request={request} timeZone={league.timeZone} />
      )}
      {!settled && (
        <section aria-labelledby="how" className="flex flex-col gap-2">
          <h2 id="how" className="text-h2">
            How it works
          </h2>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>
              Tell the league the team&apos;s name and how many are coming.
            </li>
            <li>
              A league admin reviews it and you get an email with the answer.
            </li>
            <li>
              Once approved, you captain the new team and share its invite link.
              {standing?.team && !captains && (
                <>
                  {" "}
                  You&apos;ll leave {standing.team.name}, where you&apos;re{" "}
                  {ROLE[standing.team.role]}, and its captain will be told.
                </>
              )}
            </li>
            <li>
              The team is confirmed when it has {season.rosterMin} players and
              its fee is covered. The league can help fill it with free agents.
            </li>
          </ol>
          {!standing && open && (
            <p className="text-text-muted">
              Not registered yet? You can{" "}
              <Link
                href={`/app/seasons/${slug}/register`}
                className="underline"
              >
                register a team yourself
              </Link>{" "}
              right away, no approval needed.
            </p>
          )}
        </section>
      )}
      {settled ? null : captains ? (
        <p className="rounded-lg border border-border p-3">
          You captain {standing?.team?.name} this season. To start another team,
          make someone else captain first.
        </p>
      ) : !open ? (
        <p className="rounded-lg border border-border p-3">
          Registration for {season.name} is not open, so the league is not
          taking new teams.
        </p>
      ) : !complete ? (
        <p className="rounded-lg border border-warning p-3">
          First,{" "}
          <Link href="/app/profile" className="underline">
            finish your profile
          </Link>
          : the league needs your phone, birth date and an emergency contact.
        </p>
      ) : (
        <NewTeamForm
          action={requestNewTeamAction.bind(null, slug)}
          teamFeeCents={
            season.feeModel === "per_team" && fee.ok ? fee.cents : null
          }
          splitOnly={standing?.paidOwnWay ?? false}
          rosterMin={season.rosterMin}
          rosterMax={season.rosterMax}
        />
      )}
    </>
  );
}
