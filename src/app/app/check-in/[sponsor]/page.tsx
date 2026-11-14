import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import {
  sponsorBySlug,
  sponsorDeals,
  todaysVisit,
} from "@/db/queries/sponsors";
import { kickoff } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import { dealApplies, dealOnDay, dealWhen } from "@/domain/sponsors/deals";
import { localTime } from "@/domain/time/zoned";
import { requirePermission } from "@/lib/auth/permission";
import { redeemDealAction } from "../actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Your visit" };

type Props = PageProps<"/app/check-in/[sponsor]">;

/** Today's check-in at a sponsor and the deals to use on it. */
export default function VisitPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
      <Suspense fallback={<PageLoading>Loading your visit…</PageLoading>}>
        <Visit {...props} />
      </Suspense>
    </main>
  );
}

const NOTICES: Record<string, string> = {
  checked_in: "You're checked in. Thanks for coming out!",
  already: "You already checked in here today. One a day counts.",
  used: "Deal used. Show this screen to whoever is serving you.",
};

const ERRORS: Record<string, string> = {
  not_checked_in: "Check in first: scan the code at the bar.",
  not_available: "That deal isn't on right now.",
  already_used: "You've used that deal on this visit already.",
};

async function Visit({ params, searchParams }: Props) {
  const { sponsor: slug } = await params;
  const query = await searchParams;
  const page = `/app/check-in/${slug}`;
  const subject = await requirePermission("sponsor.check_in", { next: page });
  const sponsor = await sponsorBySlug(db, slug);
  if (!sponsor) notFound();
  const league = await currentLeague(db);
  const timeZone = league?.timeZone ?? "America/New_York";
  const now = new Date();
  const day = localDay(now, timeZone);
  const time = localTime(now, timeZone);
  const [visit, deals] = await Promise.all([
    todaysVisit(db, {
      sponsorId: sponsor.id,
      userId: subject.userId,
      onDate: day,
    }),
    sponsorDeals(db, sponsor.id),
  ]);
  const today = deals.filter((d) => d.active && dealOnDay(d, day));
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const usedAt = new Map(visit?.used.map((u) => [u.dealId, u.at]));

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
          {visit ? "Checked in" : "Not checked in yet"}
        </p>
        <h1 className="text-h1">{sponsor.name}</h1>
        {visit && (
          <p className="text-text-muted">
            Today at {kickoff(visit.checkedInAt, timeZone)}
          </p>
        )}
      </header>
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {!visit && (
        <p>
          Scan the code at {sponsor.name} to check in. It&apos;s on the screen
          by the door or the register.
        </p>
      )}
      <section aria-labelledby="todays-deals" className="flex flex-col gap-3">
        <h2 id="todays-deals" className="text-h2">
          Today&apos;s deals
        </h2>
        {today.length === 0 ? (
          <p className="text-text-muted">No deals today. Enjoy the company.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {today.map((d) => {
              const used = usedAt.get(d.id);
              const on = dealApplies(d, day, time);
              return (
                <li
                  key={d.id}
                  id={`deal-${d.id}`}
                  className={`flex flex-col gap-2 rounded-card border-2 p-4 ${
                    used ? "border-success" : "border-border"
                  }`}
                >
                  <h3 className="font-bold">{d.title}</h3>
                  <p className="text-small text-text-muted">{dealWhen(d)}</p>
                  {d.terms && <p className="text-small">{d.terms}</p>}
                  {used ? (
                    <p className="font-bold">
                      <span aria-hidden="true">✓ </span>Used at{" "}
                      {kickoff(used, timeZone)}
                    </p>
                  ) : visit && on ? (
                    <form action={redeemDealAction.bind(null, slug, d.id)}>
                      <SubmitButton className="btn btn-primary">
                        Use this deal
                      </SubmitButton>
                    </form>
                  ) : (
                    <p className="text-small text-text-muted">
                      {visit ? "Not on right now." : "Check in to use it."}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Link href={`/sponsors/${slug}`} className="underline">
        About {sponsor.name}
      </Link>
    </>
  );
}
