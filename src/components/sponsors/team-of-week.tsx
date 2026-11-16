import Link from "next/link";
import type { PublicTeamOfWeek } from "@/db/queries/sponsors";
import { dayHeading } from "@/domain/schedule/format";
import { formatCents } from "@/domain/registration/pricing";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { fill } from "@/i18n/catalog";
import { formatMoney } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

/** The latest team of the week, with its tab when a sponsor put one up. */
export function TeamOfWeekCard({
  league,
  honor,
  linkSponsor = true,
  locale = DEFAULT_LOCALE,
}: {
  /** The league whose public pages the links open (ADR 0048). */
  league: LeagueRef;
  honor: PublicTeamOfWeek;
  linkSponsor?: boolean;
  /** The page's language (ADR 0065); English unless given. */
  locale?: Locale;
}) {
  const words = messagesFor(locale).teamOfWeek;
  const href = (path: string) => linkIn(locale, leagueHref(league, path));
  const sponsor =
    linkSponsor && honor.sponsorSlug ? (
      <Link
        href={href(`/sponsors/${honor.sponsorSlug}`)}
        className="inline-flex min-h-6 items-center font-bold underline"
      >
        {honor.sponsorName}
      </Link>
    ) : (
      <strong>{honor.sponsorName}</strong>
    );
  // The tab line with the sponsor's name as a link in its place.
  const [before = "", after = ""] = words.tab.split("{sponsor}");
  return (
    <section
      aria-labelledby="team-of-week"
      className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
    >
      <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
        {fill(words.label, { day: dayHeading(honor.weekOf, locale) })}
      </p>
      <h2 id="team-of-week" className="font-display text-h2">
        <Link
          href={href(`/teams/${honor.teamSlug}`)}
          className="inline-flex min-h-6 items-center underline"
        >
          {honor.teamName}
        </Link>{" "}
        <span aria-hidden="true">🏆</span>
      </h2>
      <p>{honor.reason}</p>
      {honor.tabCents !== null && honor.sponsorName && (
        <p className="text-small">
          {fill(before, {
            amount:
              locale === DEFAULT_LOCALE
                ? formatCents(honor.tabCents)
                : formatMoney(locale, honor.tabCents, { whole: true }),
          })}
          {sponsor}
          {after}
        </p>
      )}
    </section>
  );
}
