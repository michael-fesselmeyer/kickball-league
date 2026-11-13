import Link from "next/link";
import type { PublicTeamOfWeek } from "@/db/queries/sponsors";
import { dayHeading } from "@/domain/schedule/format";
import { formatCents } from "@/domain/registration/pricing";

/** The latest team of the week, with its tab when a sponsor put one up. */
export function TeamOfWeekCard({
  honor,
  linkSponsor = true,
}: {
  honor: PublicTeamOfWeek;
  linkSponsor?: boolean;
}) {
  return (
    <section
      aria-labelledby="team-of-week"
      className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
    >
      <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
        Team of the week · {dayHeading(honor.weekOf)}
      </p>
      <h2 id="team-of-week" className="font-display text-h2">
        <Link
          href={`/teams/${honor.teamSlug}`}
          className="inline-flex min-h-6 items-center underline"
        >
          {honor.teamName}
        </Link>{" "}
        <span aria-hidden="true">🏆</span>
      </h2>
      <p>{honor.reason}</p>
      {honor.tabCents !== null && honor.sponsorName && (
        <p className="text-small">
          They&apos;ve got a {formatCents(honor.tabCents)} tab at{" "}
          {linkSponsor && honor.sponsorSlug ? (
            <Link
              href={`/sponsors/${honor.sponsorSlug}`}
              className="inline-flex min-h-6 items-center font-bold underline"
            >
              {honor.sponsorName}
            </Link>
          ) : (
            <strong>{honor.sponsorName}</strong>
          )}
          , on the house.
        </p>
      )}
    </section>
  );
}
