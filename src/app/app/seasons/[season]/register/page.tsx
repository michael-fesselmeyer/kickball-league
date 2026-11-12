import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { profileOf } from "@/db/queries/profile";
import {
  myRegistration,
  seasonForRegistration,
  teamsCaptainedBy,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { parseProfileForm, toProfileForm } from "@/domain/profile/profile-form";
import {
  formatCents,
  priceFor,
  registrationWindow,
} from "@/domain/registration/pricing";
import { localDate } from "@/domain/scheduler/slots";
import { requirePermission } from "@/lib/auth/permission";
import { registerFreeAgentAction, registerTeamAction } from "./actions";
import { FreeAgentForm, TeamForm } from "./register-forms";

export const metadata: Metadata = { title: "Register" };

export default function RegisterPage(
  props: PageProps<"/app/seasons/[season]/register">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Register {...props} />
      </Suspense>
    </main>
  );
}

async function Register({
  params,
}: PageProps<"/app/seasons/[season]/register">) {
  const { season: slug } = await params;
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
    person !== null &&
    parseProfileForm(toProfileForm(person), localDate(now, league.timeZone)).ok;
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
  const pastTeams = await teamsCaptainedBy(db, league.id, subject.userId);
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
        <p className="text-text-muted">
          You become the captain and invite your players next.
        </p>
        <TeamForm
          action={registerTeamAction.bind(null, slug)}
          pastTeams={pastTeams.map((t) => ({ id: t.id, name: t.name }))}
          teamFeeCents={
            season.feeModel === "per_team" && captain.ok ? captain.cents : null
          }
          rosterMin={season.rosterMin}
          rosterMax={season.rosterMax}
        />
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
        />
      </section>
    </>
  );
}
