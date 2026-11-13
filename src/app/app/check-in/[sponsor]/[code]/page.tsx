import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { sponsorForCheckIn, todaysVisit } from "@/db/queries/sponsors";
import { localDay } from "@/domain/schedule/public-game";
import { isCurrentCheckinCode } from "@/domain/sponsors/checkin-code";
import { requirePermission } from "@/lib/auth/permission";
import { checkInAction } from "../../actions";

export const metadata: Metadata = { title: "Check in" };

type Props = PageProps<"/app/check-in/[sponsor]/[code]">;

/** Where the QR code at the bar lands: one tap to check in. */
export default function CheckInPage(props: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<p>Loading…</p>}>
        <CheckIn {...props} />
      </Suspense>
    </main>
  );
}

async function CheckIn({ params, searchParams }: Props) {
  const { sponsor: slug, code } = await params;
  const query = await searchParams;
  const page = `/app/check-in/${slug}/${code}`;
  const subject = await requirePermission("sponsor.check_in", { next: page });
  const sponsor = await sponsorForCheckIn(db, slug);
  if (!sponsor) notFound();
  const now = new Date();
  const league = await currentLeague(db);
  const visit = await todaysVisit(db, {
    sponsorId: sponsor.id,
    userId: subject.userId,
    onDate: localDay(now, league?.timeZone ?? "America/New_York"),
  });
  if (visit) redirect(`/app/check-in/${slug}`);

  const current =
    query.error !== "expired" &&
    isCurrentCheckinCode(sponsor.secret, sponsor.id, code, now);
  if (!current)
    return (
      <>
        <h1 className="text-h1">That code has moved on</h1>
        <p role="alert">
          The check-in code changes every few minutes, so this one has expired.
          Scan the code at {sponsor.name} again.
        </p>
        <Link href={`/sponsors/${slug}`} className="btn btn-secondary">
          See {sponsor.name}&apos;s deals
        </Link>
      </>
    );

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
          Check in
        </p>
        <h1 className="text-h1">You made it to {sponsor.name}</h1>
        <p className="text-text-muted">
          Checking in shows the bar how many of us came by after the game, which
          keeps the deals coming. No order needed.
        </p>
      </div>
      <form action={checkInAction.bind(null, slug, code)}>
        <button type="submit" className="btn w-full btn-primary">
          Check in
        </button>
      </form>
    </>
  );
}
