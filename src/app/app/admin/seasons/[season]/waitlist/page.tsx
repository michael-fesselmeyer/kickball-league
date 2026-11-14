import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague, seasonSettings } from "@/db/queries/seasons";
import { seasonSpots, waitlistBoard } from "@/db/queries/waitlist";
import { formatMoment } from "@/domain/money/credit";
import { freeSpots } from "@/domain/money/waitlist";
import { requirePermission } from "@/lib/auth/permission";
import { offerNowAction } from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Waitlist" };

export default function WaitlistPage(
  props: PageProps<"/app/admin/seasons/[season]/waitlist">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Waitlist {...props} />
      </Suspense>
    </main>
  );
}

const STATUS: Record<string, string> = {
  waiting: "Waiting",
  accepted: "Registered",
  expired: "Offer ran out",
  left: "Left",
};

async function Waitlist({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/waitlist">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}/waitlist`,
  });
  const league = await currentLeague(db);
  const season = league ? await seasonSettings(db, league.id, slug) : null;
  if (!league || !season) notFound();
  const now = new Date();
  const [board, spots] = await Promise.all([
    waitlistBoard(db, season.id, now),
    seasonSpots(db, { seasonId: season.id, maxTeams: season.maxTeams }, now),
  ]);
  const free = freeSpots(spots);
  const offered =
    typeof query.offered === "string" ? Number(query.offered) : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Team waitlist</h1>
        <p className="text-text-muted">
          When the season is full, captains join this line. A spot that opens
          goes to the next one, who gets an email and 48 hours to register.
          Raise the team limit in the season settings to open a spot.
        </p>
      </header>
      {offered !== null && (
        <p role="status" className="rounded-lg border border-success p-3">
          {offered === 0
            ? "No spot is free, so no offer went out."
            : `${offered} ${offered === 1 ? "offer" : "offers"} sent.`}
        </p>
      )}
      <p>
        {season.maxTeams === null
          ? "This season has no team limit, so nobody needs to wait."
          : `${spots.entered} of ${season.maxTeams} team spots taken, ${spots.liveOffers} held by offers, ${Number.isFinite(free) ? free : 0} free. ${spots.waiting} waiting.`}
      </p>
      {spots.waiting > 0 && Number.isFinite(free) && free > 0 && (
        <form action={offerNowAction.bind(null, slug)}>
          <SubmitButton className="btn self-start btn-primary">
            Offer the free {free === 1 ? "spot" : "spots"} now
          </SubmitButton>
        </form>
      )}
      {board.length === 0 ? (
        <p className="text-text-muted">Nobody is on the waitlist.</p>
      ) : (
        <ol className="flex flex-col">
          {board.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
            >
              <span className="flex flex-col">
                <span>
                  {e.displayName}
                  {e.teamName && (
                    <span className="text-text-muted"> · {e.teamName}</span>
                  )}
                </span>
                <span className="text-small text-text-muted">{e.email}</span>
              </span>
              <span className={e.live ? "text-success" : "text-text-muted"}>
                {e.status === "offered"
                  ? e.live && e.offerExpiresAt
                    ? `Offered until ${formatMoment(e.offerExpiresAt, league.timeZone)}`
                    : "Offer ran out"
                  : (STATUS[e.status] ?? e.status)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
