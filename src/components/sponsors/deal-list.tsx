import type { PublicDeal } from "@/db/queries/sponsors";
import { confirmedLabel, dealWhen } from "@/domain/sponsors/deals";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";

/** A sponsor's active deals: what, when, the fine print and when confirmed. */
export function DealList({
  deals,
  headingLevel = 3,
  locale = DEFAULT_LOCALE,
}: {
  deals: readonly PublicDeal[];
  headingLevel?: 3 | 4;
  /** The page's language (ADR 0065); English unless given. */
  locale?: Locale;
}) {
  if (deals.length === 0)
    return <p className="text-text-muted">{messagesFor(locale).deals.none}</p>;
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <ul className="flex flex-col gap-3">
      {deals.map((d) => (
        <li
          key={d.id}
          className="flex flex-col gap-1 border-l-4 border-brand pl-3"
        >
          <Heading className="font-bold">{d.title}</Heading>
          <p className="text-small">{dealWhen(d, locale)}</p>
          {d.terms && <p className="text-small text-text-muted">{d.terms}</p>}
          <p className="text-micro text-text-muted">
            {confirmedLabel(d.confirmedOn, locale)}
          </p>
        </li>
      ))}
    </ul>
  );
}
