import Link from "next/link";
import { db } from "@/db/client";
import { teamHistory } from "@/db/queries/history";
import type { TeamId } from "@/domain/ids";
import { pctText, recordLine, signedText } from "@/domain/history/history";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";
import { fill, plural } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

type Props = {
  /** The league whose public pages the links open (ADR 0048). */
  league: LeagueRef;
  team: { id: TeamId; slug: string; name: string };
  /** The page's language (ADR 0065); English unless given. */
  locale?: Locale;
};

/** A team's record over every season it played, and the titles it won. */
export async function AllTimeRecord({
  league,
  team,
  locale = DEFAULT_LOCALE,
}: Props) {
  const words = messagesFor(locale).allTime;
  const { record, titles } = await teamHistory(db, team.id, team.slug);
  if (record.played === 0) return null;
  const stats = [
    { label: words.record, value: recordLine(record), wide: true },
    { label: words.seasons, value: String(record.seasons) },
    { label: words.pct, value: pctText(record.winPct) },
    { label: words.diff, value: signedText(record.runDifference) },
    { label: words.titles, value: String(record.titles) },
  ];
  return (
    <section aria-labelledby="all-time" className="flex flex-col gap-3">
      <h2 id="all-time" className="text-h2">
        {words.title}
      </h2>
      <dl className="grid grid-cols-2 gap-2 text-center">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`flex flex-col-reverse gap-1 rounded-card border border-border bg-surface p-3 ${s.wide ? "col-span-2" : ""}`}
          >
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              {s.label}
            </dt>
            <dd
              className={`font-display tabular-nums ${s.wide ? "text-h2" : "text-h3"}`}
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
      {titles.length > 0 && (
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-bold">
            {plural(locale, words.champions, titles.length)}
          </span>
          {titles.map((t) => (
            <span key={t.slug} className="sticker">
              {t.name}
            </span>
          ))}
        </p>
      )}
      <p className="text-small text-text-muted">
        {fill(words.note, { team: team.name })}{" "}
        <Link
          href={linkIn(locale, leagueHref(league, "/history"))}
          className="underline"
        >
          {words.history}
        </Link>
      </p>
    </section>
  );
}
