import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  amountOwed,
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { hasSignedSeasonWaiver } from "@/db/queries/waivers";
import { formatCents, registrationWindow } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Your season" };

export default function SeasonPage(props: PageProps<"/app/seasons/[season]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Season {...props} />
      </Suspense>
    </main>
  );
}

function Step({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 border-b border-border py-3">
      <span
        aria-hidden="true"
        className={done ? "text-success" : "text-text-muted"}
      >
        {done ? "✓" : "○"}
      </span>
      <div className="flex flex-col gap-1">
        <p>
          <strong>{title}</strong>
          <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

async function Season({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("team.register", {
    next: `/app/seasons/${slug}`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const now = new Date();

  const header = (
    <header className="flex flex-col gap-1">
      <Link href="/app" className="underline">
        Home
      </Link>
      <h1 className="text-h1">{season.name}</h1>
    </header>
  );
  if (!mine) {
    const window = registrationWindow(season, now);
    return (
      <>
        {header}
        {window === "open" ? (
          <Link
            href={`/app/seasons/${slug}/register`}
            className="btn self-start btn-primary"
          >
            Register for {season.name}
          </Link>
        ) : (
          <p>
            {window === "not_open"
              ? "Registration has not opened yet."
              : "Registration for this season is closed."}
          </p>
        )}
      </>
    );
  }

  const signed = await hasSignedSeasonWaiver(db, subject.userId, season.id);
  const owed = amountOwed(season, mine, now);
  const deadline = season.paymentDeadlineAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeZone: league.timeZone,
      }).format(season.paymentDeadlineAt)
    : null;
  return (
    <>
      {header}
      {(query.registered || query.joined) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.joined
            ? `You're on ${mine.team?.teamName ?? "the team"}. Next, sign the waiver.`
            : query.registered === "team"
              ? "Your team is registered. Next, invite your players and sign the waiver."
              : "You're in the free-agent pool. Next, sign the waiver."}
        </p>
      )}
      <ol className="flex flex-col">
        <Step
          done
          title={
            mine.team
              ? `${mine.team.role === "captain" ? "Captain of" : "Playing for"} ${mine.team.teamName}`
              : "Registered as a free agent"
          }
        >
          {mine.team?.paymentMode === "split" && (
            <p className="text-text-muted">
              Each player pays a fixed {formatCents(mine.team.shareCents ?? 0)}.
            </p>
          )}
          {mine.team && (
            <Link href={`/app/seasons/${slug}/team`} className="underline">
              {mine.team.role === "player"
                ? "See your team"
                : "Invite players and see your roster"}
            </Link>
          )}
        </Step>
        <Step done={signed} title="Sign the waiver">
          {!signed && (
            <Link href={`/app/seasons/${slug}/waiver`} className="underline">
              Read and sign the waiver
            </Link>
          )}
        </Step>
        <Step
          done={false}
          title={
            owed.ok && owed.cents > 0
              ? `Pay ${formatCents(owed.cents)}`
              : "Payment"
          }
        >
          <p className="text-text-muted">
            {!signed
              ? "Payment opens once you have signed the waiver."
              : "Online payment is coming soon."}
            {deadline && ` Pay by ${deadline}.`}
          </p>
        </Step>
      </ol>
    </>
  );
}
