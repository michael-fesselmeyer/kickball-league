import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { profileOf } from "@/db/queries/profile";
import { ageMessage, underAge } from "@/domain/registration/age";
import {
  myRegistration,
  seasonForRegistration,
  teamsCaptainedBy,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { myWaitlistEntry, seasonSpots } from "@/db/queries/waitlist";
import { formatMoment } from "@/domain/money/credit";
import { mayRegisterTeam } from "@/domain/money/waitlist";
import { readyToRegister } from "@/domain/profile/profile-form";
import {
  formatCents,
  priceFor,
  registrationWindow,
} from "@/domain/registration/pricing";
import { localDate } from "@/domain/scheduler/slots";
import { requirePermission } from "@/lib/auth/permission";
import { registerFreeAgentAction, registerTeamAction } from "./actions";
import { FreeAgentForm, TeamForm } from "./register-forms";
import { joinWaitlistAction, leaveWaitlistAction } from "./waitlist-actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

const WAITLIST_NOTICES: Record<string, string> = {
  joined: "You're on the waitlist. We'll email you the moment a spot opens.",
  left: "You've left the waitlist.",
  already_waiting: "You're already on the waitlist.",
  spot_open: "A spot is open right now. Register your team below.",
  already_registered: "You're already registered for this season.",
  closed: "Registration for this season is closed.",
};

export const metadata: Metadata = { title: "Register" };

export default function RegisterPage(
  props: PageProps<"/app/seasons/[season]/register">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Register {...props} />
      </Suspense>
    </main>
  );
}

async function Register({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]/register">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("team.register", {
    next: `/app/seasons/${slug}/register`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  if (await myRegistration(db, season.id, subject.userId))
    redirect(`/app/seasons/${slug}`);

  const now = new Date();
  const window = registrationWindow(season, now);
  const person = await profileOf(db, subject.userId);
  const complete =
    person !== null && readyToRegister(person, localDate(now, league.timeZone));
  const header = (
    <header className="flex flex-col gap-1">
      <p className="text-text-muted">{season.name}</p>
      <h1 className="text-h1">Register</h1>
    </header>
  );
  if (window !== "open")
    return (
      <>
        {header}
        <p>
          {window === "not_open"
            ? "Registration has not opened yet."
            : "Registration for this season is closed."}
        </p>
      </>
    );
  if (
    underAge(
      season.minimumAge,
      person?.birthDate ?? null,
      localDate(now, league.timeZone),
    )
  )
    return (
      <>
        {header}
        <p role="alert" className="rounded-lg border border-warning p-3">
          {ageMessage("under_age", season.minimumAge)}
        </p>
        <Link
          href="/app/profile"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Your profile
        </Link>
      </>
    );
  if (!complete)
    return (
      <>
        {header}
        <p className="rounded-lg border border-warning p-3">
          First,{" "}
          <Link href="/app/profile" className="underline">
            finish your profile
          </Link>
          : the league needs your phone, birth date and an emergency contact.
        </p>
      </>
    );

  const captain = priceFor(
    season,
    { kind: "captain", paymentMode: "full", rosterSize: season.rosterMin },
    now,
  );
  const freeAgent = priceFor(season, { kind: "free_agent" }, now);
  const [pastTeams, spots, waiting] = await Promise.all([
    teamsCaptainedBy(db, league.id, subject.userId),
    seasonSpots(
      db,
      {
        seasonId: season.id,
        maxTeams: season.maxTeams,
        userId: subject.userId,
      },
      now,
    ),
    myWaitlistEntry(db, season.id, subject.userId, now),
  ]);
  const holdsOffer = spots.myOffer !== null;
  const teamSpot = mayRegisterTeam(spots, holdsOffer);
  const notice =
    typeof query.waitlist === "string"
      ? WAITLIST_NOTICES[query.waitlist]
      : undefined;
  const early =
    captain.ok && captain.earlyBird && season.earlyBirdEndsAt
      ? ` Early-bird pricing until ${new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeZone: league.timeZone,
        }).format(season.earlyBirdEndsAt)}.`
      : "";

  return (
    <>
      {header}
      {notice && (
        <p role="status" className="rounded-lg border border-border p-3">
          {notice}
        </p>
      )}
      {holdsOffer && waiting?.offerExpiresAt && (
        <p role="status" className="rounded-lg border border-success p-3">
          <strong>A spot is yours.</strong> We&apos;re holding it until{" "}
          {formatMoment(waiting.offerExpiresAt, league.timeZone)}. Register your
          team below to take it.
        </p>
      )}
      <p>
        {season.feeModel === "per_player"
          ? `Every player pays their own ${captain.ok ? formatCents(captain.cents) : "fee"}.`
          : `A team costs ${captain.ok ? formatCents(captain.cents) : "a team fee"}.`}
        {early}
      </p>
      <section aria-labelledby="team" className="flex flex-col gap-3">
        <h2 id="team" className="text-h2">
          Register a team
        </h2>
        {teamSpot ? (
          <p className="text-text-muted">
            You become the captain and invite your players next.
          </p>
        ) : waiting?.state === "waiting" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p>
              <strong>You&apos;re #{waiting.position} on the waitlist</strong>
              {waiting.teamName ? ` with ${waiting.teamName}` : ""}. When a spot
              opens, we&apos;ll email you and hold it for 48 hours.
            </p>
            <form action={leaveWaitlistAction.bind(null, slug)}>
              <SubmitButton className="btn btn-secondary">
                Leave the waitlist
              </SubmitButton>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p>
              <strong>All {season.maxTeams} team spots are taken.</strong> Join
              the waitlist: when a spot opens, the next team in line gets an
              email and 48 hours to claim it.
              {waiting?.state === "expired" &&
                " Your last offer ran out, so you're back at the end of the line."}
            </p>
            <form
              action={joinWaitlistAction.bind(null, slug)}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1">
                <span className="text-small">Team name (optional)</span>
                <input
                  name="teamName"
                  maxLength={40}
                  autoComplete="off"
                  className="w-56 rounded-md border border-border bg-surface px-2 py-1"
                />
              </label>
              <SubmitButton className="btn btn-primary">
                Join the waitlist
              </SubmitButton>
            </form>
          </div>
        )}
        {teamSpot && (
          <TeamForm
            action={registerTeamAction.bind(null, slug)}
            pastTeams={pastTeams.map((t) => ({ id: t.id, name: t.name }))}
            teamFeeCents={
              season.feeModel === "per_team" && captain.ok
                ? captain.cents
                : null
            }
            rosterMin={season.rosterMin}
            rosterMax={season.rosterMax}
            minimumAge={season.minimumAge}
          />
        )}
      </section>
      <section aria-labelledby="free-agent" className="flex flex-col gap-3">
        <h2 id="free-agent" className="text-h2">
          Or join on your own
        </h2>
        <FreeAgentForm
          action={registerFreeAgentAction.bind(null, slug)}
          priceLabel={
            freeAgent.ok ? `It costs ${formatCents(freeAgent.cents)}.` : ""
          }
          minimumAge={season.minimumAge}
        />
      </section>
    </>
  );
}
