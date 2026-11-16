import { LOCALE_NAMES, type Locale } from "@/i18n/locales";
import { offeredLocales } from "@/i18n/pages";

/**
 * The footer's language links (ADR 0094), rendered on the server with no
 * client JavaScript. Each goes through `/language/<code>`, which sends the
 * visitor on to the page they were on, in that language where it is
 * translated (src/i18n/routing.ts, languageSwitchTarget). Nothing until a
 * second language has a translated page.
 */
export function LanguageSwitcher({
  current,
  label,
}: {
  current: Locale;
  label: string;
}) {
  const locales = offeredLocales();
  if (locales.length < 2) return null;
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {locales.map((locale) => (
          <li key={locale}>
            {/* A plain link: the target is a redirect, not a page to prefetch. */}
            <a
              href={`/language/${locale}`}
              hrefLang={locale}
              lang={locale}
              rel="nofollow"
              aria-current={locale === current ? "true" : undefined}
              className="inline-flex min-h-11 items-center font-bold text-text underline-offset-4 hover:underline aria-[current=true]:underline"
            >
              {LOCALE_NAMES[locale]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
